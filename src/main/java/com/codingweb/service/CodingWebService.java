package com.codingweb.service;

import com.codingweb.model.DatabaseFile;
import com.codingweb.model.DatabaseState;
import com.codingweb.model.Problem;
import com.codingweb.model.ProblemListItem;
import com.codingweb.model.ProblemRequest;
import com.codingweb.model.ProblemView;
import com.codingweb.model.Submission;
import com.codingweb.model.SubmissionListItem;
import com.codingweb.model.SubmissionRequest;
import com.codingweb.model.SubmissionResponse;
import com.codingweb.model.TestCase;
import com.codingweb.model.TestCaseRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
// 这是项目的业务中枢：题目管理、提交历史、本地存储读写都在这里协调完成。
public class CodingWebService {
  private static final String SEED_PROBLEM_ID = "seed-two-sum";
  private static final int MAX_CODE_LENGTH = 120_000;
  private final ObjectMapper objectMapper;
  private final Path dbFile;
  private final Path dataDir;
  private final JudgeService judgeService;

  public CodingWebService(
      ObjectMapper objectMapper,
      JudgeService judgeService,
      @Value("${codingweb.data-dir:data}") String dataDir) {
    // 通过构造器注入依赖，后面测试或替换实现时会更容易。
    this.objectMapper = objectMapper;
    this.judgeService = judgeService;
    this.dataDir = Path.of(dataDir).toAbsolutePath().normalize();
    this.dbFile = this.dataDir.resolve("db.json");
  }

  public DatabaseState<List<ProblemListItem>> listProblems() {
    // 题库列表只返回列表页需要的轻量字段。
    DatabaseFile db = readDb();
    List<ProblemListItem> items = db.problems().stream()
        .map(this::toProblemListItem)
        .toList();
    return new DatabaseState<>(items);
  }

  public SeedRestoreResult restoreSeedProblem() {
    // 先查是否已经存在示例题，避免重复插入。
    DatabaseFile db = readDb();
    Optional<Problem> existing = db.problems().stream()
        .filter(problem -> SEED_PROBLEM_ID.equals(problem.id()) || "两数之和".equals(problem.title()))
        .findFirst();
    if (existing.isPresent()) {
      return new SeedRestoreResult(toEditableProblem(existing.get()), false);
    }

    Problem problem = createSeedProblem();
    List<Problem> problems = new ArrayList<>(db.problems());
    problems.add(0, problem);
    writeDb(new DatabaseFile(problems, db.submissions()));
    return new SeedRestoreResult(toEditableProblem(problem), true);
  }

  public ProblemView createProblem(ProblemRequest request) {
    // 新建题目时先做字段清洗，再写回本地 JSON。
    DatabaseFile db = readDb();
    Problem problem = normalizeProblemPayload(request, null);
    List<Problem> problems = new ArrayList<>(db.problems());
    problems.add(0, problem);
    writeDb(new DatabaseFile(problems, db.submissions()));
    return toEditableProblem(problem);
  }

  public ProblemView getProblemForEdit(String id) {
    return toEditableProblem(findProblemOrFail(id));
  }

  public ProblemView getPublicProblem(String id) {
    return toPublicProblem(findProblemOrFail(id));
  }

  public ProblemView updateProblem(String id, ProblemRequest request) {
    // 更新时保留原题目的 id 和创建时间，只刷新内容与更新时间。
    DatabaseFile db = readDb();
    List<Problem> problems = new ArrayList<>(db.problems());
    int index = indexOfProblem(problems, id);
    if (index < 0) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "题目不存在");
    }
    Problem existing = problems.get(index);
    Problem updated = normalizeProblemPayload(request, existing);
    problems.set(index, updated);
    writeDb(new DatabaseFile(problems, db.submissions()));
    return toEditableProblem(updated);
  }

  public void deleteProblem(String id) {
    // 删除题目后，同时清理它的提交记录，避免历史列表里留下孤儿数据。
    DatabaseFile db = readDb();
    List<Problem> problems = db.problems().stream()
        .filter(problem -> !Objects.equals(problem.id(), id))
        .collect(Collectors.toCollection(ArrayList::new));
    if (problems.size() == db.problems().size()) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "题目不存在");
    }
    List<Submission> submissions = db.submissions().stream()
        .filter(submission -> !Objects.equals(submission.problemId(), id))
        .collect(Collectors.toCollection(ArrayList::new));
    writeDb(new DatabaseFile(problems, submissions));
  }

  public SubmissionResponse runSubmission(SubmissionRequest request) {
    // 运行样例不落库，只返回本次判题结果给前端看。
    SubmissionResult result = prepareSubmission(request, "RUN_SAMPLE");
    return new SubmissionResponse(result.submission());
  }

  public SubmissionResponse createSubmission(SubmissionRequest request) {
    // 正式提交会生成 id 并写入历史记录，供“提交记录”页面查看。
    SubmissionResult result = prepareSubmission(request, "SUBMIT");
    Submission submission = result.submission();
    Submission persisted = new Submission(
        UUID.randomUUID().toString(),
        submission.problemId(),
        submission.code(),
        submission.language(),
        submission.mode(),
        submission.status(),
        submission.passedCount(),
        submission.totalCount(),
        submission.timeUsedMs(),
        submission.memoryUsedMb(),
        submission.errorMessage(),
        submission.caseResults(),
        submission.createdAt(),
        submission.updatedAt());

    DatabaseFile db = readDb();
    List<Submission> submissions = new ArrayList<>(db.submissions());
    submissions.add(persisted);
    writeDb(new DatabaseFile(db.problems(), submissions));
    return new SubmissionResponse(persisted);
  }

  public DatabaseState<List<SubmissionListItem>> listSubmissions() {
    // 列表页展示提交摘要，代码本体放到详情接口里。
    DatabaseFile db = readDb();
    Map<String, String> titleById = db.problems().stream()
        .collect(Collectors.toMap(Problem::id, Problem::title, (left, right) -> left, LinkedHashMap::new));
    List<SubmissionListItem> items = db.submissions().stream()
        .filter(submission -> "SUBMIT".equals(submission.mode()))
        .sorted(Comparator.comparing(Submission::createdAt).reversed())
        .map(submission -> new SubmissionListItem(
            submission.id(),
            submission.problemId(),
            titleById.getOrDefault(submission.problemId(), "已删除题目"),
            submission.mode(),
            submission.status(),
            submission.passedCount(),
            submission.totalCount(),
            submission.timeUsedMs(),
            submission.createdAt()))
        .toList();
    return new DatabaseState<>(items);
  }

  public Submission getSubmission(String id) {
    return readDb().submissions().stream()
        .filter(submission -> Objects.equals(submission.id(), id))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "提交记录不存在"));
  }

  private SubmissionResult prepareSubmission(SubmissionRequest request, String mode) {
    // 统一处理运行样例和正式提交的公共步骤：校验参数、取题目、选择用例、执行判题。
    String problemId = safeTrim(request.problemId());
    String code = request.code() == null ? "" : request.code();
    // 先把最基础的错误挡在外面，避免后续判题逻辑拿到脏数据。
    if (problemId.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "缺少题目 ID");
    }
    if (code.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "代码不能为空");
    }
    if (code.length() > MAX_CODE_LENGTH) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "代码长度超过限制");
    }

    Problem problem = findProblemOrFail(problemId);
    // 运行样例时只跑 isSample=true 的用例；正式提交时则跑全部用例。
    List<TestCase> cases = "RUN_SAMPLE".equals(mode)
        ? problem.testCases().stream().filter(testCase -> Boolean.TRUE.equals(testCase.isSample())).toList()
        : problem.testCases();
    if (cases.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "RUN_SAMPLE".equals(mode) ? "该题还没有样例用例" : "该题还没有测试用例");
    }

    JudgeService.JudgeResult judgeResult = judgeService.judgeJava(problem, code, cases, mode);
    String now = Instant.now().toString();
    // Submission 先在内存里组装好，是否落库由调用方决定。
    Submission submission = new Submission(
        null,
        problem.id(),
        code,
        "JAVA",
        mode,
        judgeResult.status(),
        judgeResult.passedCount(),
        judgeResult.totalCount(),
        judgeResult.timeUsedMs(),
        null,
        judgeResult.errorMessage(),
        judgeResult.caseResults(),
        now,
        now);
    return new SubmissionResult(problem, submission);
  }

  private Problem findProblemOrFail(String id) {
    return readDb().problems().stream()
        .filter(problem -> Objects.equals(problem.id(), id))
        .findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "题目不存在"));
  }

  private int indexOfProblem(List<Problem> problems, String id) {
    for (int i = 0; i < problems.size(); i++) {
      if (Objects.equals(problems.get(i).id(), id)) {
        return i;
      }
    }
    return -1;
  }

  private DatabaseFile readDb() {
    // 本项目先用 JSON 文件代替数据库，方便本地开发和理解数据结构。
    ensureStorage();
    try {
      // 如果文件还不存在，就先初始化一份示例数据，保证第一次启动就能看到页面内容。
      if (!Files.exists(dbFile)) {
        DatabaseFile seed = new DatabaseFile(List.of(createSeedProblem()), List.of());
        writeDb(seed);
        return seed;
      }
      String raw = Files.readString(dbFile, StandardCharsets.UTF_8);
      DatabaseFile db = objectMapper.readValue(raw, DatabaseFile.class);
      return new DatabaseFile(db.problems(), db.submissions());
    } catch (IOException error) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "读取数据失败", error);
    }
  }

  private void writeDb(DatabaseFile db) {
    // 每次写回时都格式化输出，方便直接打开 data/db.json 检查数据。
    ensureStorage();
    try {
      String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(db);
      Files.writeString(dbFile, json + System.lineSeparator(), StandardCharsets.UTF_8);
    } catch (JsonProcessingException error) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "序列化数据失败", error);
    } catch (IOException error) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "写入数据失败", error);
    }
  }

  private void ensureStorage() {
    // data/ 和 tmp/ 都属于运行时目录，启动时统一确保它们存在。
    try {
      Files.createDirectories(dataDir);
      Files.createDirectories(Path.of("tmp", "judge"));
    } catch (IOException error) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "初始化存储失败", error);
    }
  }

  private Problem createSeedProblem() {
    // 内置一题作为初始示例，让新项目启动后立刻能跑通完整流程。
    String now = "2026-04-27T00:00:00.000Z";
    return new Problem(
        SEED_PROBLEM_ID,
        "两数之和",
        "简单",
        List.of("数组", "哈希表"),
        "给定一个整数数组 nums 和一个目标值 target，请输出数组中和为 target 的两个元素下标。保证每组数据只有一个答案。",
        String.join("\n",
            "## 思路",
            "",
            "用哈希表记录每个数字之前出现的位置。",
            "",
            "遍历数组时，先计算 `target - nums[i]`，如果它已经出现过，就直接输出这两个下标。",
            "",
            "## 复杂度",
            "",
            "- 时间复杂度：`O(n)`",
            "- 空间复杂度：`O(n)`"),
        "第一行输入两个整数 n 和 target。第二行输入 n 个整数，表示数组 nums。",
        "输出两个整数，表示满足条件的两个下标，按从小到大输出。",
        "2 <= n <= 10000，-100000 <= nums[i], target <= 100000。",
        String.join("\n",
            "import java.util.*;",
            "",
            "public class Main {",
            "    public static void main(String[] args) {",
            "        Scanner scanner = new Scanner(System.in);",
            "        int n = scanner.nextInt();",
            "        int target = scanner.nextInt();",
            "        int[] nums = new int[n];",
            "        for (int i = 0; i < n; i++) {",
            "            nums[i] = scanner.nextInt();",
            "        }",
            "",
            "        Map<Integer, Integer> seen = new HashMap<>();",
            "        for (int i = 0; i < n; i++) {",
            "            int need = target - nums[i];",
            "            if (seen.containsKey(need)) {",
            "                int a = seen.get(need);",
            "                int b = i;",
            "                System.out.println(Math.min(a, b) + \" \" + Math.max(a, b));",
            "                return;",
            "            }",
            "            seen.put(nums[i], i);",
            "        }",
            "    }",
            "}"),
        2000,
        256,
        List.of(
            new TestCase("seed-case-1", "4 9\n2 7 11 15\n", "0 1\n", true, 1),
            new TestCase("seed-case-2", "3 6\n3 2 4\n", "1 2\n", true, 2),
            new TestCase("seed-case-3", "2 6\n3 3\n", "0 1\n", false, 3)),
        now,
        now);
  }

  private Problem normalizeProblemPayload(ProblemRequest request, Problem existing) {
    // 这里把前端表单数据统一规范化，避免空字符串、非法难度等脏数据进入存储层。
    String now = Instant.now().toString();
    String title = safeTrim(request.title());
    // 题目标题是最基础的标识，不允许为空。
    if (title.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "题目标题不能为空");
    }
    List<String> tags = normalizeTags(request.tags());
    List<TestCase> testCases = normalizeTestCases(request.testCases(), existing);
    return new Problem(
        existing == null ? UUID.randomUUID().toString() : existing.id(),
        title,
        normalizeDifficulty(request.difficulty()),
        tags,
        request.description() == null ? "" : request.description(),
        request.solution() == null ? "" : request.solution(),
        request.inputDescription() == null ? "" : request.inputDescription(),
        request.outputDescription() == null ? "" : request.outputDescription(),
        request.constraints() == null ? "" : request.constraints(),
        normalizeTemplate(request.javaTemplate()),
        clampNumber(request.timeLimitMs(), 500, 10000, 2000),
        clampNumber(request.memoryLimitMb(), 64, 1024, 256),
        testCases,
        existing == null ? now : existing.createdAt(),
        now);
  }

  private List<String> normalizeTags(Object rawTags) {
    // 前端可能传数组，也可能传逗号分隔的字符串，这里兼容两种输入形式。
    if (rawTags instanceof List<?> list) {
      return list.stream()
          .map(String::valueOf)
          .map(String::trim)
          .filter(value -> !value.isBlank())
          .toList();
    }
    String text = rawTags == null ? "" : String.valueOf(rawTags);
    if (text.isBlank()) {
      return List.of();
    }
    return Arrays.stream(text.split(","))
        .map(String::trim)
        .filter(value -> !value.isBlank())
        .toList();
  }

  private List<TestCase> normalizeTestCases(List<TestCaseRequest> requests, Problem existing) {
    // 测试用例按顺序重建 id 和 sortOrder，方便前端编辑与后端保存保持一致。
    if (requests == null) {
      return existing == null ? List.of() : existing.testCases();
    }
    List<TestCase> testCases = new ArrayList<>();
    for (int i = 0; i < requests.size(); i++) {
      TestCaseRequest request = requests.get(i);
      testCases.add(new TestCase(
          request.id() == null || request.id().isBlank() ? UUID.randomUUID().toString() : request.id(),
          request.input() == null ? "" : request.input(),
          request.expectedOutput() == null ? "" : request.expectedOutput(),
          Boolean.TRUE.equals(request.isSample()),
          i + 1));
    }
    return testCases;
  }

  private String normalizeDifficulty(String difficulty) {
    if ("中等".equals(difficulty) || "困难".equals(difficulty)) {
      return difficulty;
    }
    return "简单";
  }

  private String normalizeTemplate(String javaTemplate) {
    return javaTemplate == null || javaTemplate.isBlank() ? defaultJavaTemplate() : javaTemplate;
  }

  private String defaultJavaTemplate() {
    return String.join("\n",
        "import java.util.*;",
        "",
        "public class Main {",
        "    public static void main(String[] args) {",
        "        Scanner scanner = new Scanner(System.in);",
        "        // 在这里编写代码",
        "    }",
        "}");
  }

  private int clampNumber(Integer value, int min, int max, int fallback) {
    if (value == null) {
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  }

  private ProblemListItem toProblemListItem(Problem problem) {
    // 题库列表只需要看题目名、难度和样例/隐藏用例数量。
    long sampleCount = problem.testCases().stream().filter(testCase -> Boolean.TRUE.equals(testCase.isSample())).count();
    long hiddenCount = problem.testCases().size() - sampleCount;
    return new ProblemListItem(
        problem.id(),
        problem.title(),
        problem.difficulty(),
        problem.tags(),
        (int) sampleCount,
        (int) hiddenCount,
        problem.updatedAt());
  }

  private ProblemView toPublicProblem(Problem problem) {
    // 做题页返回完整题面，但只保留样例用例。
    List<TestCase> sampleCases = problem.testCases().stream()
        .filter(testCase -> Boolean.TRUE.equals(testCase.isSample()))
        .map(testCase -> new TestCase(
            testCase.id(),
            testCase.input(),
            testCase.expectedOutput(),
            true,
            testCase.sortOrder()))
        .toList();
    return new ProblemView(
        problem.id(),
        problem.title(),
        problem.difficulty(),
        problem.tags(),
        problem.description(),
        problem.solution() == null ? "" : problem.solution(),
        problem.inputDescription(),
        problem.outputDescription(),
        problem.constraints(),
        problem.javaTemplate(),
        problem.timeLimitMs(),
        problem.memoryLimitMb(),
        sampleCases,
        problem.createdAt(),
        problem.updatedAt());
  }

  private ProblemView toEditableProblem(Problem problem) {
    // 编辑页需要完整数据，所以这里直接返回全部测试用例。
    return new ProblemView(
        problem.id(),
        problem.title(),
        problem.difficulty(),
        problem.tags(),
        problem.description(),
        problem.solution(),
        problem.inputDescription(),
        problem.outputDescription(),
        problem.constraints(),
        problem.javaTemplate(),
        problem.timeLimitMs(),
        problem.memoryLimitMb(),
        problem.testCases(),
        problem.createdAt(),
        problem.updatedAt());
  }

  private static String safeTrim(String value) {
    // 小工具：把空值统一成空字符串，再去掉首尾空白。
    return value == null ? "" : value.trim();
  }

  private record SubmissionResult(Problem problem, Submission submission) {
  }

  public record SeedRestoreResult(ProblemView problem, boolean restored) {
  }
}
