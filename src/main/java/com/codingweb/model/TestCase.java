package com.codingweb.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
// 单个测试用例的内容，包括输入、期望输出和是否公开给前端。
public record TestCase(
    String id,
    String input,
    String expectedOutput,
    Boolean isSample,
    Integer sortOrder) {
}
