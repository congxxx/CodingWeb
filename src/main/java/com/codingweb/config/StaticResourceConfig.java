package com.codingweb.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    // 直接把仓库根目录下的 public/ 当成静态站点目录使用。
    registry.addResourceHandler("/**")
        .addResourceLocations("file:public/")
        .setCacheControl(CacheControl.noStore());
  }
}
