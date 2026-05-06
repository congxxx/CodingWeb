package com.codingweb.model;

// 前端编辑测试用例时提交的单条用例数据。
public record TestCaseRequest(
    String id,
    String input,
    String expectedOutput,
    Boolean isSample) {
}
