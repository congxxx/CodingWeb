package com.codingweb.model;

import java.util.List;

// 列表页只需要的题目摘要信息。
public record ProblemListItem(
    String id,
    String title,
    String difficulty,
    List<String> tags,
    int sampleCount,
    int hiddenCount,
    String updatedAt) {
}
