package com.codingweb.service;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class BootIndexController {

  @GetMapping("/")
  public String index() {
    // 根路径直接转到 index.html，这样浏览器打开 http://127.0.0.1:3000/ 就能看到页面。
    return "forward:/index.html";
  }
}
