package com.codingweb.controller;

import com.codingweb.model.ProblemListItem;
import com.codingweb.model.ProblemRequest;
import com.codingweb.model.ProblemView;
import com.codingweb.model.SubmissionListItem;
import com.codingweb.model.SubmissionRequest;
import com.codingweb.model.SubmissionResponse;
import com.codingweb.service.CodingWebService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
// 这一层只负责“接收请求 + 调用业务服务 + 返回 JSON”，尽量不放业务细节。
public class CodingWebController {
  private final CodingWebService service;

  public CodingWebController(CodingWebService service) {
    this.service = service;
  }

  @GetMapping("/problems")
  public Map<String, List<ProblemListItem>> listProblems() {
    // 前端列表页只需要摘要信息，所以这里不返回完整题面。
    return Map.of("problems", service.listProblems().problems());
  }

  @PostMapping("/problems/seed")
  public Map<String, Object> restoreSeedProblem() {
    // 这个接口的返回值里除了题目本体，还带一个 restored 标记，前端可以据此给出提示。
    CodingWebService.SeedRestoreResult result = service.restoreSeedProblem();
    return Map.of("problem", result.problem(), "restored", result.restored());
  }

  @PostMapping("/problems")
  public Map<String, ProblemView> createProblem(@Valid @RequestBody ProblemRequest request) {
    return Map.of("problem", service.createProblem(request));
  }

  @GetMapping("/problems/{id}/edit")
  public Map<String, ProblemView> getProblemForEdit(@PathVariable String id) {
    return Map.of("problem", service.getProblemForEdit(id));
  }

  @GetMapping("/problems/{id}")
  public Map<String, ProblemView> getPublicProblem(@PathVariable String id) {
    // 做题页只能拿到样例用例，避免把隐藏用例泄露给用户。
    return Map.of("problem", service.getPublicProblem(id));
  }

  @PutMapping("/problems/{id}")
  public Map<String, ProblemView> updateProblem(@PathVariable String id, @Valid @RequestBody ProblemRequest request) {
    // 路径里的 id 由 URL 提供，修改内容由请求体提供，这样接口语义更清晰。
    return Map.of("problem", service.updateProblem(id, request));
  }

  @DeleteMapping("/problems/{id}")
  public ResponseEntity<?> deleteProblem(@PathVariable String id) {
    service.deleteProblem(id);
    return ResponseEntity.ok().body(java.util.Map.of("ok", true));
  }

  @PostMapping("/submissions/run")
  public SubmissionResponse runSubmission(@Valid @RequestBody SubmissionRequest request) {
    // 运行样例只做即时判题，不会把记录写入历史表。
    return service.runSubmission(request);
  }

  @PostMapping("/submissions/submit")
  public SubmissionResponse createSubmission(@Valid @RequestBody SubmissionRequest request) {
    // 正式提交会落库，后续“提交记录”页面就是从这里读取的。
    return service.createSubmission(request);
  }

  @GetMapping("/submissions")
  public Map<String, List<SubmissionListItem>> listSubmissions() {
    // 列表页同样只返回摘要，提交代码本体留到详情接口里。
    return Map.of("submissions", service.listSubmissions().problems());
  }

  @GetMapping("/submissions/{id}")
  public Map<String, Object> getSubmission(@PathVariable String id) {
    return Map.of("submission", service.getSubmission(id));
  }
}
