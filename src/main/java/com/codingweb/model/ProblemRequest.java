package com.codingweb.model;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

// 前端提交“题目编辑表单”时使用的请求体。
public record ProblemRequest(
    @NotBlank String title,
    String difficulty,
    Object tags,
    String description,
    String solution,
    String inputDescription,
    String outputDescription,
    String constraints,
    String javaTemplate,
    Integer timeLimitMs,
    Integer memoryLimitMb,
    List<TestCaseRequest> testCases) {
}
