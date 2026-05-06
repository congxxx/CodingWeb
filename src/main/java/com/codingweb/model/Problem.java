package com.codingweb.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
// 一道题目的完整数据结构，既用于展示题目，也用于编辑和持久化。
public record Problem(
    String id,
    String title,
    String difficulty,
    List<String> tags,
    String description,
    String solution,
    String inputDescription,
    String outputDescription,
    String constraints,
    String javaTemplate,
    Integer timeLimitMs,
    Integer memoryLimitMb,
    List<TestCase> testCases,
    String createdAt,
    String updatedAt) {

  public Problem {
    tags = tags == null ? new ArrayList<>() : List.copyOf(tags);
    testCases = testCases == null ? new ArrayList<>() : List.copyOf(testCases);
  }
}
