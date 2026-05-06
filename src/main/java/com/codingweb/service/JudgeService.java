package com.codingweb.service;

import com.codingweb.model.Problem;
import com.codingweb.model.Submission;
import com.codingweb.model.TestCase;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
// 这个类专门负责“把用户代码跑起来并判题”，所有和编译、运行、超时相关的逻辑都放在这里。
public class JudgeService {
  private static final int MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
  private static final Pattern[] BLOCKED_PATTERNS = {
      Pattern.compile("\\bRuntime\\b|\\bProcessBuilder\\b|\\.exec\\s*\\("),
      Pattern.compile("\\bSystem\\s*\\.\\s*exit\\s*\\("),
      Pattern.compile("\\bSocket\\b|\\bServerSocket\\b|\\bURLClassLoader\\b"),
      Pattern.compile("\\bFileInputStream\\b|\\bFileOutputStream\\b|\\bRandomAccessFile\\b|\\bFiles\\b|\\bPaths\\b")
  };

  public JudgeResult judgeJava(Problem problem, String code, List<TestCase> cases, String mode) {
    // 判题主流程：先做静态安全检查，再编译，最后按测试用例逐个运行和比对输出。
    String guardMessage = validateJavaCode(code);
    if (!guardMessage.isBlank()) {
      return new JudgeResult(
          "COMPILE_ERROR",
          0,
          cases.size(),
          0L,
          guardMessage,
          List.of());
    }

    Path workDir = Path.of("tmp", "judge", java.util.UUID.randomUUID().toString()).toAbsolutePath().normalize();
    try {
      // 每个提交都单独创建一个临时目录，避免不同提交之间文件互相污染。
      Files.createDirectories(workDir);
      Files.writeString(workDir.resolve("Main.java"), code, StandardCharsets.UTF_8);

      // 第一阶段：先编译。编译失败就不再进入运行阶段。
      ProcessResult compile = runProcess("javac", List.of("-encoding", "UTF-8", "Main.java"), workDir, 5_000, "");
      if (compile.timedOut()) {
        return new JudgeResult("COMPILE_ERROR", 0, cases.size(), compile.durationMs(), "编译超时", List.of());
      }
      if (compile.exitCode() != 0) {
        return new JudgeResult(
            "COMPILE_ERROR",
            0,
            cases.size(),
            compile.durationMs(),
            truncateOutput(firstNonBlank(compile.stderr(), compile.stdout(), "编译失败")),
            List.of());
      }

      List<Submission.CaseResult> caseResults = new ArrayList<>();
      int passedCount = 0;
      long maxTime = 0L;
      // 第二阶段：逐个测试用例执行。任何一个用例出错都可以提前结束。
      for (int index = 0; index < cases.size(); index++) {
        TestCase testCase = cases.get(index);
        ProcessResult run = runProcess(
            "java",
            List.of("-Xmx" + Math.max(64, problem.memoryLimitMb()) + "m", "Main"),
            workDir,
            Math.max(500, problem.timeLimitMs()),
            testCase.input() == null ? "" : testCase.input());
        maxTime = Math.max(maxTime, run.durationMs());

        if (run.timedOut()) {
          // 超时通常说明代码死循环或算法复杂度过高。
          caseResults.add(buildCaseResult(testCase, index, "TIME_LIMIT_EXCEEDED", run, mode, "运行超时"));
          return new JudgeResult("TIME_LIMIT_EXCEEDED", passedCount, cases.size(), maxTime, "运行超时", caseResults);
        }
        if (run.outputOverflow()) {
          // 输出量太大时直接判为运行错误，防止内存被输出撑爆。
          caseResults.add(buildCaseResult(testCase, index, "RUNTIME_ERROR", run, mode, "输出超过限制"));
          return new JudgeResult("RUNTIME_ERROR", passedCount, cases.size(), maxTime, "输出超过限制", caseResults);
        }
        if (run.exitCode() != 0) {
          // 进程非正常退出时，通常是运行时异常或 JVM 报错。
          String message = truncateOutput(firstNonBlank(run.stderr(), "运行错误"));
          caseResults.add(buildCaseResult(testCase, index, "RUNTIME_ERROR", run, mode, message));
          return new JudgeResult("RUNTIME_ERROR", passedCount, cases.size(), maxTime, message, caseResults);
        }

        // 输出完全一致才算通过；这里保留了常见的空白行尾处理。
        boolean accepted = normalizeOutput(run.stdout()).equals(normalizeOutput(testCase.expectedOutput()));
        if (!accepted) {
          caseResults.add(buildCaseResult(testCase, index, "WRONG_ANSWER", run, mode, "答案错误"));
          return new JudgeResult("WRONG_ANSWER", passedCount, cases.size(), maxTime, "答案错误", caseResults);
        }

        passedCount++;
        caseResults.add(buildCaseResult(testCase, index, "ACCEPTED", run, mode, ""));
      }

      return new JudgeResult("ACCEPTED", passedCount, cases.size(), maxTime, "", caseResults);
    } catch (IOException error) {
      return new JudgeResult("SYSTEM_ERROR", 0, cases.size(), 0L, error.getMessage(), List.of());
    } finally {
      try {
        deleteRecursively(workDir);
      } catch (IOException ignored) {
        // 保留临时文件失败不影响本次判题结果。
      }
    }
  }

  private Submission.CaseResult buildCaseResult(TestCase testCase, int index, String status, ProcessResult run, String mode, String message) {
    // 样例模式可以展示输入、期望输出和实际输出；隐藏用例只展示结果状态。
    boolean canShowContent = "RUN_SAMPLE".equals(mode) || Boolean.TRUE.equals(testCase.isSample());
    return new Submission.CaseResult(
        index + 1,
        testCase.isSample(),
        status,
        run.durationMs(),
        message,
        canShowContent ? nullSafe(testCase.input()) : "",
        canShowContent ? nullSafe(testCase.expectedOutput()) : "",
        canShowContent ? truncateOutput(run.stdout()) : "");
  }

  private String validateJavaCode(String code) {
    // 这只是基础拦截，不是正式安全沙箱；真正上线仍应使用容器隔离。
    // 先检查最核心的结构要求：必须包含 public class Main。
    if (!Pattern.compile("\\bpublic\\s+class\\s+Main\\b").matcher(code).find()) {
      return "Java 代码必须包含 public class Main";
    }
    // 再扫描一些明显危险的 API，尽量挡住创建进程、访问网络、读写文件等行为。
    for (Pattern pattern : BLOCKED_PATTERNS) {
      if (pattern.matcher(code).find()) {
        if (pattern.pattern().contains("Runtime") || pattern.pattern().contains("ProcessBuilder")) {
          return "暂不允许创建系统进程";
        }
        if (pattern.pattern().contains("System")) {
          return "暂不允许调用 System.exit";
        }
        if (pattern.pattern().contains("Socket") || pattern.pattern().contains("URLClassLoader")) {
          return "暂不允许访问网络或动态加载类";
        }
        return "暂不允许访问本机文件";
      }
    }
    return "";
  }

  private ProcessResult runProcess(String command, List<String> args, Path cwd, long timeoutMs, String input) throws IOException {
    // 把命令执行、标准输入输出、超时、耗时统计统一封装起来。
    ProcessBuilder builder = new ProcessBuilder();
    builder.command(buildCommand(command, args));
    builder.directory(cwd.toFile());
    builder.redirectErrorStream(false);
    long startedAt = System.currentTimeMillis();
    Process process = builder.start();

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      // 用两个异步任务分别收集 stdout 和 stderr，避免某一边缓冲区阻塞导致子进程卡住。
      CompletableFuture<StreamData> stdoutFuture = CompletableFuture.supplyAsync(() -> readStream(process.getInputStream()), executor);
      CompletableFuture<StreamData> stderrFuture = CompletableFuture.supplyAsync(() -> readStream(process.getErrorStream()), executor);
      // 判题程序只通过标准输入和标准输出通信，不依赖文件或网络。
      try (OutputStream stdin = process.getOutputStream()) {
        stdin.write(input.getBytes(StandardCharsets.UTF_8));
      }

      boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
      if (!finished) {
        process.destroyForcibly();
      }
      int exitCode = finished ? process.exitValue() : -1;
      StreamData stdoutData = stdoutFuture.join();
      StreamData stderrData = stderrFuture.join();
      boolean overflow = stdoutData.overflow() || stderrData.overflow() || exitCode == -1 && !finished;
      return new ProcessResult(exitCode, stdoutData.text(), stderrData.text(), !finished, overflow, System.currentTimeMillis() - startedAt);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IOException("判题进程被中断", error);
    } finally {
      executor.shutdownNow();
    }
  }

  private List<String> buildCommand(String command, List<String> args) {
    List<String> commandLine = new ArrayList<>();
    commandLine.add(command);
    commandLine.addAll(args);
    return commandLine;
  }

  private StreamData readStream(InputStream inputStream) {
    // 同时限制输出大小，避免用户程序疯狂打印把内存撑爆。
    long startedAt = System.currentTimeMillis();
    try (InputStream in = inputStream; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
      byte[] chunk = new byte[4096];
      int read;
      long total = 0;
      boolean overflow = false;
      while ((read = in.read(chunk)) != -1) {
        total += read;
        if (total > MAX_OUTPUT_BYTES) {
          overflow = true;
          break;
        }
        buffer.write(chunk, 0, read);
      }
      return new StreamData(buffer.toString(StandardCharsets.UTF_8), overflow, System.currentTimeMillis() - startedAt);
    } catch (IOException error) {
      return new StreamData("", true, System.currentTimeMillis() - startedAt);
    }
  }

  private void deleteRecursively(Path root) throws IOException {
    // 每次判题都用独立临时目录，结束后清理掉，防止 tmp 目录无限膨胀。
    if (!Files.exists(root)) {
      return;
    }
    try (var paths = Files.walk(root)) {
      paths.sorted((left, right) -> right.compareTo(left)).forEach(path -> {
        try {
          Files.deleteIfExists(path);
        } catch (IOException error) {
          throw new RuntimeException(error);
        }
      });
    } catch (RuntimeException error) {
      if (error.getCause() instanceof IOException ioException) {
        throw ioException;
      }
      throw error;
    }
  }

  private String normalizeOutput(String value) {
    // 输出比对时尽量模拟题库常见规则：统一换行符，并忽略行尾空白。
    return String.valueOf(value == null ? "" : value)
        .replace("\r\n", "\n")
        .replace('\r', '\n')
        .lines()
        .map(line -> line.replaceAll("[ \\t]+$", ""))
        .collect(java.util.stream.Collectors.joining("\n"))
        .replaceAll("\\n+$", "");
  }

  private String truncateOutput(String value) {
    // 错误信息过长时只保留前半段，避免前端界面被日志淹没。
    String text = value == null ? "" : value;
    return text.length() > 4000 ? text.substring(0, 4000) + "\n...输出已截断" : text;
  }

  private String nullSafe(String value) {
    return value == null ? "" : value;
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return "";
  }

  private record ProcessResult(int exitCode, String stdout, String stderr, boolean timedOut, boolean outputOverflow, long durationMs) {
  }

  private record StreamData(String text, boolean overflow, long durationMs) {
  }

  public record JudgeResult(
      String status,
      int passedCount,
      int totalCount,
      long timeUsedMs,
      String errorMessage,
      List<Submission.CaseResult> caseResults) {
  }
}
