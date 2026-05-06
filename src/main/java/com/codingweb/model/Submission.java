package com.codingweb.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
// 一次运行或提交的判题结果，既保存题目关联信息，也保存每个测试点的结果。
public record Submission(
    String id,
    String problemId,
    String code,
    String language,
    String mode,
    String status,
    Integer passedCount,
    Integer totalCount,
    Long timeUsedMs,
    Integer memoryUsedMb,
    String errorMessage,
    List<CaseResult> caseResults,
    String createdAt,
    String updatedAt) {

  public Submission {
    caseResults = caseResults == null ? new ArrayList<>() : List.copyOf(caseResults);
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record CaseResult(
      Integer index,
      Boolean isSample,
      String status,
      Long timeUsedMs,
      String message,
      String input,
      String expectedOutput,
      String actualOutput) {
  }
}
