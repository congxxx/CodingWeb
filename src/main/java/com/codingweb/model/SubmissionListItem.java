package com.codingweb.model;

// 提交记录列表页的摘要信息。
public record SubmissionListItem(
    String id,
    String problemId,
    String problemTitle,
    String mode,
    String status,
    Integer passedCount,
    Integer totalCount,
    Long timeUsedMs,
    String createdAt) {
}
