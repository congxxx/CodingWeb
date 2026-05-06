package com.codingweb.model;

import jakarta.validation.constraints.NotBlank;

// 前端运行样例或正式提交时发送的最小请求体。
public record SubmissionRequest(
    @NotBlank String problemId,
    @NotBlank String code) {
}
