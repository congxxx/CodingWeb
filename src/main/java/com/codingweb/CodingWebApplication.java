package com.codingweb;

import java.net.BindException;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
// 这是整个项目的启动入口，Spring Boot 会从这里开始装配 Web 容器、Controller、Service 和配置。
public class CodingWebApplication {

  public static void main(String[] args) {
    // 按 3000 -> 3010 的顺序尝试端口，尽量保留原项目的本地开发习惯。
    for (int port = 3000; port <= 3010; port++) {
      SpringApplication application = new SpringApplication(CodingWebApplication.class);
      Map<String, Object> defaults = new HashMap<>();
      defaults.put("server.port", port);
      defaults.put("server.address", "127.0.0.1");
      application.setDefaultProperties(defaults);
      try {
        application.run(args);
        return;
      } catch (Exception error) {
        if (isBindPortError(error) && port < 3010) {
          continue;
        }
        throw error;
      }
    }
  }

  private static boolean isBindPortError(Throwable error) {
    // Spring 启动失败原因很多，这里只判断“端口被占用”这一类可恢复错误。
    Throwable current = error;
    while (current != null) {
      if (current instanceof BindException) {
        return true;
      }
      String message = current.getMessage();
      if (message != null && (message.contains("Address already in use") || message.contains("Port"))) {
        return true;
      }
      current = current.getCause();
    }
    return false;
  }
}
