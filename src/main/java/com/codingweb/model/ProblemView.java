package com.codingweb.model;

import java.util.List;

// 返回给前端的题目视图对象，做题页和编辑页都会用到。
public record ProblemView(
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
}
