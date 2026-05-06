package com.codingweb.model;

// 统一包装判题返回值，便于前端直接从 submission 字段取结果。
public record SubmissionResponse(Submission submission) {
}
