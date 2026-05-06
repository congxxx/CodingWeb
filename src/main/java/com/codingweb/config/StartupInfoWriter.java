package com.codingweb.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

@Component
// 启动完成后把实际访问地址写到 tmp/server.json，方便脚本或手动排查端口。
public class StartupInfoWriter implements ApplicationListener<WebServerInitializedEvent> {
  private final String serverAddress = "127.0.0.1";
  private volatile int serverPort = 3000;

  @Override
  public void onApplicationEvent(WebServerInitializedEvent event) {
    // 先记录 Spring 真正启动成功后的端口，后面写 tmp/server.json 时会用到。
    this.serverPort = event.getWebServer().getPort();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void writeServerInfo() throws IOException {
    // 和原 Node 版本保持一致，方便前端或脚本读取当前实际访问地址。
    Path file = Path.of("tmp", "server.json");
    Files.createDirectories(file.getParent());
    String json = """
        {
          "url": "%s",
          "port": %d,
          "pid": %d
        }
        """.formatted("http://" + serverAddress + ":" + serverPort, serverPort, currentPid());
    Files.writeString(file, json, StandardCharsets.UTF_8);
  }

  private static long currentPid() {
    return ProcessHandle.current().pid();
  }
}
