package com.codingweb.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
// 对应 data/db.json 的整体结构：题目列表 + 提交列表。
public record DatabaseFile(List<Problem> problems, List<Submission> submissions) {
  public DatabaseFile {
    problems = problems == null ? new ArrayList<>() : List.copyOf(problems);
    submissions = submissions == null ? new ArrayList<>() : List.copyOf(submissions);
  }
}
