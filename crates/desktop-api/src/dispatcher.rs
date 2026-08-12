use std::sync::Arc;

use onpeople_core_runtime::{CoreRuntime, MAX_EVENT_REPLAY_LIMIT};
use onpeople_types::{
    AppError, AppUpdateState, ErrorCode, GitCommitRequest, GitFileRequest, GitMutationRequest,
    GitPushRequest, GitRequest, GoalRequest, GoalUpdateRequest, IdRequest, PreferencePatchRequest,
    Preferences, ProviderRequest, ReasoningRequest, SaveProviderRequest,
    ScheduledTaskMutationRequest, ScheduledTaskRequest, SchedulerSnapshot, TerminalIdRequest,
    TerminalResizeRequest, TerminalStartRequest, TerminalWriteRequest, ThreadFilters,
    ThreadMutationRequest, ThreadRequest, UsageSnapshot, WorktreeRequest,
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    AgentIdRequest, AgentListRequest, AgentMessageRequest, AgentProfileIdRequest,
    AgentProfileSaveRequest, AuthorizedProjectAction, BrowserActionRequest,
    BrowserAnnotationDeleteRequest, BrowserAnnotationRequest, BrowserCommandRequest,
    BrowserHostOperation, BrowserRouteRequest, BrowserSurfaceBoundsRequest,
    CloudGroupSelectRequest, CloudLoginRequest, CloudPayloadRequest, CloudRedeemRequest,
    CloudRegisterRequest, CloudRegistrationCodeRequest, ConnectorOauthCompleteRequest,
    ContextRequest, DESKTOP_PROTOCOL_VERSION, DesktopCapabilities, DesktopEvent, DesktopHost,
    DesktopMethod, DesktopRequest, DesktopResponse, EffectiveConfig, EffectiveConfigRequest,
    EventReplay, EventReplayRequest, ExtensionsListRequest, ExtensionsSnapshot, FileListRequest,
    FilePreview, FilePreviewRequest, FileSearchRequest, GeneratedImage, GitHunkMutationRequest,
    GitPullRequestRequest, GitReviewStartRequest, GitReviewSubmitRequest, HookCreateRequest,
    HookDefinition, HookListRequest, LiveCloseRequest, LiveCreateRequest, LocalArtifactRequest,
    MemoryDeleteRequest, MemoryListRequest, MemorySaveRequest, MemorySaveResult,
    MemorySettingsRequest, MemoryState, ModelCatalog, ModelValidation, ModelValidationRequest,
    NewTaskRequest, PluginCatalogSyncRequest, PluginIdRequest, PluginPayloadRequest,
    PolicySaveRequest, PolicyState, ProjectActionAuthorizeRequest, ProjectPathRequest,
    ProjectUpdateRequest, QueuedTaskMessage, QuickLauncherRequest, RuntimeSnapshotRequest,
    ScheduledTaskFromTextRequest, SchedulerMarkReadRequest, SecretDeleteRequest,
    SecretDeleteResult, SecretList, SecretSaveRequest, SecretSaveResult, ShellAppUpdateCheck,
    ShellAppUpdateDownload, ShellAppUpdateInstall, ShellEditorOpenRequest, ShellExternalUrlRequest,
    ShellFileSelection, ShellFileSelectionRequest, ShellGeneratedImageCopy,
    ShellGeneratedImageRequest, ShellGeneratedImageReveal, ShellHostOperation,
    ShellMicrophoneAccess, ShellOpenTaskWindowRequest, ShellOpenedPath, ShellOpenedUrl,
    ShellPickDownloadDirectoryRequest, ShellProjectRequest, ShellThreadRequest, ShellThreadReveal,
    SkillEnabledRequest, SkillEnabledState, TaskApprovalResolution, TaskApprovalResolveRequest,
    TaskCancelRequest, TaskCancellation, TaskHandle, TaskInputResolution, TaskInputResolveRequest,
    TaskQueueDeletion, TaskQueueItemRequest, TaskQueueRequest, TaskQueueSteerReceipt, TaskRecovery,
    TaskResumeRequest, TaskSnapshot, TaskSnapshotRequest, TaskStartRequest, TaskState,
    TaskSteerReceipt, TaskSteerRequest, TerminalContextMenu, TerminalContextMenuRequest,
    TerminalFocusRequest, TerminalFocusState, TerminalReadyState, ThreadAutoNameRequest,
    UsagePriceRequest, WorktreePathRequest, should_forward_desktop_event,
};

#[derive(Clone)]
pub struct DesktopDispatcher {
    runtime: Arc<CoreRuntime>,
}

impl DesktopDispatcher {
    #[must_use]
    pub const fn new(runtime: Arc<CoreRuntime>) -> Self {
        Self { runtime }
    }

    pub async fn dispatch(&self, request: DesktopRequest) -> DesktopResponse {
        self.dispatch_inner(request, None).await
    }

    /// Dispatches a request with access to shell-owned capabilities.
    /// Headless callers keep using [`Self::dispatch`].
    pub async fn dispatch_with_host(
        &self,
        request: DesktopRequest,
        host: &dyn DesktopHost,
    ) -> DesktopResponse {
        self.dispatch_inner(request, Some(host)).await
    }

    async fn dispatch_inner(
        &self,
        request: DesktopRequest,
        host: Option<&dyn DesktopHost>,
    ) -> DesktopResponse {
        let request_id = request.request_id.clone();
        if request.protocol_version != DESKTOP_PROTOCOL_VERSION {
            return DesktopResponse::failure(
                request_id,
                AppError::new(
                    ErrorCode::Unsupported,
                    format!(
                        "桌面协议版本不兼容: client={}, server={DESKTOP_PROTOCOL_VERSION}",
                        request.protocol_version
                    ),
                )
                .context("clientVersion", request.protocol_version)
                .context("serverVersion", DESKTOP_PROTOCOL_VERSION),
            );
        }

        match self
            .dispatch_method(request.method, request.params, host)
            .await
        {
            Ok(result) => DesktopResponse::success(request_id, result),
            Err(error) => DesktopResponse::failure(request_id, error),
        }
    }

    async fn dispatch_method(
        &self,
        method: DesktopMethod,
        params: Value,
        host: Option<&dyn DesktopHost>,
    ) -> Result<Value, AppError> {
        match method {
            DesktopMethod::SystemCapabilities => {
                let mut capabilities = DesktopCapabilities::default();
                if host.is_none() {
                    capabilities
                        .methods
                        .retain(|method| !method.requires_host());
                }
                to_value(capabilities)
            }
            DesktopMethod::RuntimeStatus => to_value(self.runtime.agent_status()?),
            DesktopMethod::RuntimeStart => {
                self.runtime.start().await?;
                Ok(Value::Null)
            }
            DesktopMethod::RuntimeStop => {
                self.runtime.stop().await;
                Ok(Value::Null)
            }
            DesktopMethod::RuntimeSnapshot => {
                let request: RuntimeSnapshotRequest = parse_params(params)?;
                to_value(self.runtime.runtime_snapshot(request.thread_id.as_deref()))
            }
            DesktopMethod::RuntimeDiagnostics => to_value(self.runtime.runtime_diagnostics()),
            DesktopMethod::RuntimeRestart => to_value(self.runtime.restart_runtime().await?),
            DesktopMethod::EventReplay => {
                let request: EventReplayRequest = parse_params(params)?;
                let limit = request
                    .limit
                    .map_or(256, |value| value as usize)
                    .min(MAX_EVENT_REPLAY_LIMIT);
                if limit == 0 {
                    return Err(AppError::invalid("event.replay limit 必须大于 0"));
                }
                let window = self
                    .runtime
                    .event_replay_window(request.after_sequence, limit);
                let events = window
                    .events
                    .into_iter()
                    .filter(should_forward_desktop_event)
                    .map(DesktopEvent::from)
                    .collect::<Vec<_>>();
                let latest_sequence = window.newest_sequence.unwrap_or(0);
                let oldest_available_sequence = window.oldest_sequence;
                let requires_snapshot = window.contains_truncated
                    || oldest_available_sequence
                        .is_some_and(|oldest| request.after_sequence.saturating_add(1) < oldest);
                to_value(EventReplay {
                    events,
                    oldest_available_sequence,
                    latest_sequence,
                    next_sequence: window.scanned_cursor,
                    requires_snapshot,
                    has_more: window.has_more,
                })
            }
            DesktopMethod::PreferencesGet => to_value(self.runtime.preferences()?),
            DesktopMethod::PreferencesSave => {
                let request: PreferencePatchRequest = parse_params(params)?;
                to_value(self.runtime.save_preferences(request)?)
            }
            DesktopMethod::ThreadList => {
                let filters: ThreadFilters = parse_params(params)?;
                to_value(self.runtime.list_threads(filters).await?)
            }
            DesktopMethod::ThreadTimeline => {
                let request: ThreadRequest = parse_params(params)?;
                to_value(self.runtime.thread_timeline(&request.thread_id)?)
            }
            DesktopMethod::ThreadNew => {
                let request: NewTaskRequest = parse_params(params)?;
                self.runtime.new_task(request.cwd.as_deref()).await
            }
            DesktopMethod::ThreadFork => {
                let request: ThreadRequest = parse_params(params)?;
                self.runtime
                    .thread_command("fork_thread", &json!({ "threadId": request.thread_id }))
                    .await
            }
            DesktopMethod::ThreadArchive => {
                let request: ThreadRequest = parse_params(params)?;
                self.runtime
                    .thread_command("archive_thread", &json!({ "threadId": request.thread_id }))
                    .await
            }
            DesktopMethod::ThreadUnarchive => {
                let request: ThreadRequest = parse_params(params)?;
                self.runtime
                    .thread_command(
                        "unarchive_thread",
                        &json!({ "threadId": request.thread_id }),
                    )
                    .await
            }
            DesktopMethod::ThreadPin => {
                let request: ThreadMutationRequest = parse_params(params)?;
                self.runtime
                    .thread_command(
                        "pin_thread",
                        &json!({ "threadId": request.thread_id, "value": request.value }),
                    )
                    .await
            }
            DesktopMethod::ThreadUnread => {
                let request: ThreadMutationRequest = parse_params(params)?;
                self.runtime
                    .thread_command(
                        "mark_thread_unread",
                        &json!({ "threadId": request.thread_id, "value": request.value }),
                    )
                    .await
            }
            DesktopMethod::ThreadRename => {
                let request: ThreadMutationRequest = parse_params(params)?;
                self.runtime
                    .thread_command(
                        "rename_thread",
                        &json!({ "threadId": request.thread_id, "value": request.value }),
                    )
                    .await
            }
            DesktopMethod::ThreadAutoName => {
                let request: ThreadAutoNameRequest = parse_params(params)?;
                let payload = to_value(request)?;
                self.runtime.auto_name_thread(&payload).await
            }
            DesktopMethod::ThreadReasoning => {
                let request: ReasoningRequest = parse_params(params)?;
                self.runtime
                    .set_thread_reasoning(
                        &request.thread_id,
                        &request.effort,
                        request.model.as_deref(),
                    )
                    .await
            }
            DesktopMethod::GoalSet => {
                let request: GoalRequest = parse_params(params)?;
                to_value(self.runtime.set_goal(request).await?)
            }
            DesktopMethod::GoalUpdate => {
                let request: GoalUpdateRequest = parse_params(params)?;
                to_value(self.runtime.update_goal(request).await?)
            }
            DesktopMethod::ContextState => {
                let request: ContextRequest = parse_params(params)?;
                self.runtime.context_state(request.thread_id.as_deref())
            }
            DesktopMethod::ContextCompact => {
                let request: ContextRequest = parse_params(params)?;
                self.runtime
                    .compact_context(request.thread_id.as_deref())
                    .await
            }
            DesktopMethod::ContextRecalibrate => {
                let request: ContextRequest = parse_params(params)?;
                self.runtime
                    .recalibrate_context(request.thread_id.as_deref())
                    .await
            }
            DesktopMethod::ProjectUpdate => {
                let request: ProjectUpdateRequest = parse_params(params)?;
                self.runtime.update_project(
                    &request.project_path,
                    &request.action,
                    request.value.as_ref(),
                )
            }
            DesktopMethod::ProjectArchiveTasks => {
                let request: ProjectPathRequest = parse_params(params)?;
                self.runtime
                    .archive_project_tasks(&request.project_path)
                    .await
            }
            DesktopMethod::ProjectQuickLauncher => {
                let request: QuickLauncherRequest = parse_params(params)?;
                to_value(
                    self.runtime
                        .quick_launcher_suggestions(&request.cwd, &request.query)?,
                )
            }
            DesktopMethod::AgentList => {
                let request: AgentListRequest = parse_params(params)?;
                Ok(json!({
                    "agents": self
                        .runtime
                        .list_agent_tasks(request.parent_thread_id.as_deref())
                        .await?,
                }))
            }
            DesktopMethod::AgentProfileList => {
                Ok(json!({ "profiles": self.runtime.list_agent_profiles()? }))
            }
            DesktopMethod::AgentProfileSave => {
                let request: AgentProfileSaveRequest = parse_params(params)?;
                let profile = Value::Object(request.profile.into_iter().collect());
                self.runtime.save_agent_profile_and_reload(&profile).await
            }
            DesktopMethod::AgentProfileDelete => {
                let request: AgentProfileIdRequest = parse_params(params)?;
                self.runtime
                    .delete_agent_profile_and_reload(&request.profile_id)
                    .await
            }
            DesktopMethod::AgentMessage => {
                let request: AgentMessageRequest = parse_params(params)?;
                self.runtime
                    .message_agent(&request.agent_id, &request.text)
                    .await
            }
            DesktopMethod::AgentStop => {
                let request: AgentIdRequest = parse_params(params)?;
                self.runtime.stop_agent(&request.agent_id).await
            }
            DesktopMethod::AgentRead => {
                let request: AgentIdRequest = parse_params(params)?;
                self.runtime.read_agent(&request.agent_id).await
            }
            DesktopMethod::WorktreeSnapshot => {
                let request: WorktreePathRequest = parse_params(params)?;
                self.runtime
                    .snapshot_worktree(&request.worktree_path, request.output.as_deref())
            }
            DesktopMethod::WorktreeHandoff => {
                let request: WorktreePathRequest = parse_params(params)?;
                self.runtime.handoff_worktree(&request.worktree_path)
            }
            DesktopMethod::SchedulerGet => to_value(self.runtime.scheduler_snapshot()),
            DesktopMethod::SchedulerCreate => {
                let request: ScheduledTaskRequest = parse_params(params)?;
                to_value(self.runtime.create_scheduled_task(request)?)
            }
            DesktopMethod::SchedulerCreateFromText => {
                let request: ScheduledTaskFromTextRequest = parse_params(params)?;
                let payload = to_value(request)?;
                to_value(self.runtime.create_scheduled_task_from_text(&payload)?)
            }
            DesktopMethod::SchedulerUpdate => {
                let request: ScheduledTaskMutationRequest = parse_params(params)?;
                to_value(self.runtime.update_scheduled_task(request)?)
            }
            DesktopMethod::SchedulerDelete => {
                let request: IdRequest = parse_params(params)?;
                to_value(self.runtime.delete_scheduled_task(&request.id)?)
            }
            DesktopMethod::SchedulerRun => {
                let request: IdRequest = parse_params(params)?;
                self.runtime.run_scheduled_task(&request.id).await
            }
            DesktopMethod::SchedulerMarkRead => {
                let request: SchedulerMarkReadRequest = parse_params(params)?;
                to_value(
                    self.runtime
                        .mark_scheduled_notifications_read(request.run_id.as_deref())?,
                )
            }
            DesktopMethod::CloudAccount => to_value(self.runtime.cloud_state()),
            DesktopMethod::CloudLogin => {
                let request: CloudLoginRequest = parse_params(params)?;
                let payload = to_value(request)?;
                to_value(self.runtime.cloud_login(&payload).await?)
            }
            DesktopMethod::CloudRegistrationCodeSend => {
                let request: CloudRegistrationCodeRequest = parse_params(params)?;
                let payload = to_value(request)?;
                self.runtime.cloud_send_registration_code(&payload).await
            }
            DesktopMethod::CloudRegister => {
                let request: CloudRegisterRequest = parse_params(params)?;
                let payload = to_value(request)?;
                to_value(self.runtime.cloud_register(&payload).await?)
            }
            DesktopMethod::CloudLogout => to_value(self.runtime.cloud_logout()?),
            DesktopMethod::CloudRedeem => {
                let request: CloudRedeemRequest = parse_params(params)?;
                let payload = to_value(request)?;
                self.runtime.cloud_redeem(&payload).await
            }
            DesktopMethod::CloudGroups => {
                Ok(json!({ "groups": self.runtime.cloud_groups().await? }))
            }
            DesktopMethod::CloudGroupSelect => {
                let request: CloudGroupSelectRequest = parse_params(params)?;
                let payload = to_value(request)?;
                to_value(self.runtime.cloud_select_group(&payload)?)
            }
            DesktopMethod::CloudUsage => {
                let request: CloudPayloadRequest = parse_params(params)?;
                let payload = Value::Object(request.payload.into_iter().collect());
                self.runtime.cloud_usage(&payload).await
            }
            DesktopMethod::CloudLeaderboardSave => {
                let request: CloudPayloadRequest = parse_params(params)?;
                let payload = Value::Object(request.payload.into_iter().collect());
                self.runtime.save_cloud_leaderboard_preference(&payload)
            }
            DesktopMethod::LiveStatus => to_value(self.runtime.live_status()),
            DesktopMethod::LiveCreate => {
                let request: LiveCreateRequest = parse_params(params)?;
                let payload = to_value(request)?;
                self.runtime.create_live_session(&payload).await
            }
            DesktopMethod::LiveClose => {
                let request: LiveCloseRequest = parse_params(params)?;
                let payload = to_value(request)?;
                self.runtime.close_live_session(&payload).await
            }
            DesktopMethod::TaskStart => {
                let request: TaskStartRequest = parse_params(params)?;
                let submission = self
                    .runtime
                    .send_prompt(onpeople_types::SendPromptRequest {
                        thread_id: request.thread_id,
                        text: request.text,
                        cwd: request.cwd,
                        workspace_mode: request.workspace_mode,
                        images: request.images,
                        attachments: request.attachments,
                        capability: request.capability,
                        mode: request.mode,
                        industry_plugin: request.industry_plugin,
                        model: request.model,
                        reasoning_effort: request.reasoning_effort,
                    })
                    .await?;
                to_value(TaskHandle {
                    task_id: submission.turn_id,
                    thread_id: submission.thread_id,
                    state: if submission.queued {
                        TaskState::Queued
                    } else {
                        TaskState::Running
                    },
                    accepted_at: chrono::Utc::now(),
                    last_sequence: self.runtime.event_cursor(),
                })
            }
            DesktopMethod::TaskCancel => {
                let request: TaskCancelRequest = parse_params(params)?;
                if request.thread_id.trim().is_empty() {
                    return Err(AppError::invalid("缺少 threadId"));
                }
                let active = self.runtime.runtime_snapshot(None);
                let task_id = request.task_id.or_else(|| {
                    (active.thread_id.as_deref() == Some(request.thread_id.as_str()))
                        .then_some(active.turn_id)
                        .flatten()
                });
                let task_id = task_id.ok_or_else(|| AppError::invalid("没有可中断的任务"))?;
                self.runtime
                    .interrupt(&json!({
                        "threadId": request.thread_id,
                        "turnId": task_id,
                    }))
                    .await?;
                to_value(TaskCancellation {
                    task_id,
                    thread_id: request.thread_id,
                    state: TaskState::Cancelling,
                    last_sequence: self.runtime.event_cursor(),
                })
            }
            DesktopMethod::TaskSnapshot => {
                let request: TaskSnapshotRequest = parse_params(params)?;
                to_value(task_snapshot(&self.runtime, request)?)
            }
            DesktopMethod::TaskResume => {
                let request: TaskResumeRequest = parse_params(params)?;
                if request.thread_id.trim().is_empty() {
                    return Err(AppError::invalid("缺少 threadId"));
                }
                let resume_payload = self.runtime.resume_thread(&request.thread_id).await?;
                let timeline = resume_payload
                    .get("onpeopleTimelineItems")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let snapshot = task_snapshot(
                    &self.runtime,
                    TaskSnapshotRequest {
                        thread_id: request.thread_id,
                        task_id: None,
                    },
                )?;
                to_value(TaskRecovery {
                    snapshot,
                    resume_payload,
                    timeline,
                })
            }
            DesktopMethod::TaskQueue => {
                let request: TaskQueueRequest = parse_params(params)?;
                let queued = self
                    .runtime
                    .queue_message(request.thread_id.as_deref(), &request.text)?;
                let queued: QueuedTaskMessage = parse_result(queued)?;
                to_value(queued)
            }
            DesktopMethod::TaskQueueDelete => {
                let request: TaskQueueItemRequest = parse_params(params)?;
                let deleted = self
                    .runtime
                    .delete_queued_message(request.thread_id.as_deref(), &request.queue_id)?;
                let deleted: TaskQueueDeletion = parse_result(deleted)?;
                to_value(deleted)
            }
            DesktopMethod::TaskSteer => {
                let request: TaskSteerRequest = parse_params(params)?;
                let thread_id = resolve_interaction_thread(&self.runtime, request.thread_id)?;
                let result = self
                    .runtime
                    .steer_turn(Some(&thread_id), &request.text)
                    .await?;
                to_value(TaskSteerReceipt {
                    accepted: true,
                    task_id: active_task_id(&self.runtime, &thread_id),
                    thread_id,
                    last_sequence: self.runtime.event_cursor(),
                    result,
                })
            }
            DesktopMethod::TaskQueueSteer => {
                let request: TaskQueueItemRequest = parse_params(params)?;
                let thread_id = resolve_interaction_thread(&self.runtime, request.thread_id)?;
                let result = self
                    .runtime
                    .steer_queued_message(Some(&thread_id), &request.queue_id)
                    .await?;
                let inner_result = result.get("result").cloned().unwrap_or(Value::Null);
                to_value(TaskQueueSteerReceipt {
                    accepted: true,
                    steered: result
                        .get("steered")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    id: request.queue_id,
                    task_id: active_task_id(&self.runtime, &thread_id),
                    thread_id,
                    last_sequence: self.runtime.event_cursor(),
                    result: inner_result,
                })
            }
            DesktopMethod::TaskApprovalResolve => {
                let request: TaskApprovalResolveRequest = parse_params(params)?;
                self.runtime
                    .resolve_approval(&request.request_id, request.decision.as_runtime_value())
                    .await?;
                to_value(TaskApprovalResolution {
                    request_id: request.request_id,
                    decision: request.decision,
                })
            }
            DesktopMethod::TaskInputResolve => {
                let request: TaskInputResolveRequest = parse_params(params)?;
                self.runtime
                    .resolve_user_input(&request.request_id, to_value(&request.answers)?)
                    .await?;
                to_value(TaskInputResolution {
                    request_id: request.request_id,
                    answered: true,
                })
            }
            DesktopMethod::TerminalStart => {
                let request: TerminalStartRequest = parse_params(params)?;
                to_value(self.runtime.terminal_start(request)?)
            }
            DesktopMethod::TerminalWrite => {
                let request: TerminalWriteRequest = parse_params(params)?;
                self.runtime.terminal_write(request)?;
                Ok(Value::Null)
            }
            DesktopMethod::TerminalResize => {
                let request: TerminalResizeRequest = parse_params(params)?;
                self.runtime.terminal_resize(request)?;
                Ok(Value::Null)
            }
            DesktopMethod::TerminalTerminate => {
                let request: TerminalIdRequest = parse_params(params)?;
                self.runtime.terminal_terminate(request)?;
                Ok(Value::Null)
            }
            DesktopMethod::TerminalReady => {
                let request: TerminalIdRequest = parse_params(params)?;
                let result = self.runtime.terminal_ready(&request.process_id)?;
                to_value(parse_result::<TerminalReadyState>(result)?)
            }
            DesktopMethod::TerminalFocus => {
                let request: TerminalFocusRequest = parse_params(params)?;
                let process_id = request.focused.then_some(request.process_id).flatten();
                let result = self.runtime.set_terminal_focused(process_id)?;
                to_value(parse_result::<TerminalFocusState>(result)?)
            }
            DesktopMethod::TerminalContextMenu => {
                let request: TerminalContextMenuRequest = parse_params(params)?;
                self.runtime.terminal_ready(&request.process_id)?;
                to_value(TerminalContextMenu {
                    process_id: request.process_id,
                    items: ["copy", "paste", "selectAll", "clear", "terminate"]
                        .into_iter()
                        .map(ToOwned::to_owned)
                        .collect(),
                    has_selection: request.has_selection,
                })
            }
            DesktopMethod::FileList => {
                let request: FileListRequest = parse_params(params)?;
                to_value(self.runtime.files_list(&request.cwd, &request.relative)?)
            }
            DesktopMethod::FileSearch => {
                let request: FileSearchRequest = parse_params(params)?;
                to_value(self.runtime.files_search(&request.cwd, &request.query)?)
            }
            DesktopMethod::FilePreview => {
                let request: FilePreviewRequest = parse_params(params)?;
                let result = self.runtime.file_preview(&request.cwd, &request.path)?;
                to_value(parse_result::<FilePreview>(result)?)
            }
            DesktopMethod::FileArtifactPreview => {
                let request: LocalArtifactRequest = parse_params(params)?;
                let result = self
                    .runtime
                    .local_artifact_preview(&request.path, request.thread_id.as_deref())?;
                to_value(parse_result::<FilePreview>(result)?)
            }
            DesktopMethod::FileGeneratedImageRead => {
                let request: LocalArtifactRequest = parse_params(params)?;
                let result = self
                    .runtime
                    .generated_image(&request.path, request.thread_id.as_deref())?;
                to_value(parse_result::<GeneratedImage>(result)?)
            }
            DesktopMethod::FileProjectActions => {
                let request: GitRequest = parse_params(params)?;
                to_value(self.runtime.project_actions(&request.cwd)?)
            }
            DesktopMethod::FileProjectActionAuthorize => {
                let request: ProjectActionAuthorizeRequest = parse_params(params)?;
                let action = self
                    .runtime
                    .project_actions(&request.cwd)?
                    .into_iter()
                    .find(|action| action.id == request.action_id)
                    .ok_or_else(|| AppError::new(ErrorCode::NotFound, "项目动作不存在"))?;
                if request.fingerprint.as_deref().is_some_and(|fingerprint| {
                    !fingerprint.is_empty() && fingerprint != action.fingerprint
                }) {
                    return Err(AppError::new(
                        ErrorCode::Conflict,
                        "项目动作已发生变化，请重新选择后再执行",
                    ));
                }
                self.runtime.storage().put_metadata(
                    &format!("project.action.{}.{}", action.id, action.fingerprint),
                    &json!({
                        "cwd": request.cwd,
                        "action": &action,
                        "authorizedAt": chrono::Utc::now(),
                    }),
                )?;
                to_value(AuthorizedProjectAction {
                    id: action.id,
                    label: action.label,
                    command: action.command,
                    source: action.source,
                    fingerprint: action.fingerprint,
                    authorized: true,
                })
            }
            DesktopMethod::GitState => {
                let request: GitRequest = parse_params(params)?;
                to_value(self.runtime.git_state(request)?)
            }
            DesktopMethod::GitDiff => {
                let request: GitFileRequest = parse_params(params)?;
                to_value(self.runtime.git_diff(request)?)
            }
            DesktopMethod::GitMutate => {
                let request: GitMutationRequest = parse_params(params)?;
                to_value(self.runtime.git_mutate(request)?)
            }
            DesktopMethod::GitCommit => {
                let request: GitCommitRequest = parse_params(params)?;
                to_value(self.runtime.git_commit(request)?)
            }
            DesktopMethod::GitPush => {
                let request: GitPushRequest = parse_params(params)?;
                to_value(self.runtime.git_push(request)?)
            }
            DesktopMethod::GitInitialize => {
                let request: GitRequest = parse_params(params)?;
                to_value(self.runtime.git_initialize(&request.cwd)?)
            }
            DesktopMethod::GitHunks => {
                let request: GitFileRequest = parse_params(params)?;
                self.runtime.git_hunks(&request.cwd, &request.file_path)
            }
            DesktopMethod::GitHunkMutate => {
                let request: GitHunkMutationRequest = parse_params(params)?;
                to_value(self.runtime.mutate_git_hunk(&to_value(request)?)?)
            }
            DesktopMethod::GitPullRequestPrepare => {
                let request: GitPullRequestRequest = parse_params(params)?;
                self.runtime
                    .prepare_pull_request(&request.cwd, request.base.as_deref())
            }
            DesktopMethod::GitReviewStart => {
                let request: GitReviewStartRequest = parse_params(params)?;
                self.runtime.start_review(&to_value(request)?).await
            }
            DesktopMethod::GitReviewSubmit => {
                let request: GitReviewSubmitRequest = parse_params(params)?;
                self.runtime
                    .submit_review_comments(&to_value(request)?)
                    .await
            }
            DesktopMethod::GitWorktree => {
                let request: WorktreeRequest = parse_params(params)?;
                self.runtime.worktrees(request)
            }
            DesktopMethod::BrowserState => {
                parse_empty(params)?;
                call_browser_host(host, BrowserHostOperation::State, json!({})).await
            }
            DesktopMethod::BrowserRestart => {
                parse_empty(params)?;
                call_browser_host(host, BrowserHostOperation::Restart, json!({})).await
            }
            DesktopMethod::BrowserCommand => {
                let request: BrowserCommandRequest = parse_params(params)?;
                call_browser_host(
                    host,
                    BrowserHostOperation::Command,
                    to_value(request.command)?,
                )
                .await
            }
            DesktopMethod::BrowserSurfaceBounds => {
                let request: BrowserSurfaceBoundsRequest = parse_params(params)?;
                call_browser_host(
                    host,
                    BrowserHostOperation::SurfaceBounds,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationList => {
                let request: BrowserRouteRequest = parse_params(params)?;
                call_browser_host(
                    host,
                    BrowserHostOperation::AnnotationList,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationSave => {
                let request: BrowserAnnotationRequest = parse_params(params)?;
                call_browser_host(
                    host,
                    BrowserHostOperation::AnnotationSave,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAnnotationDelete => {
                let request: BrowserAnnotationDeleteRequest = parse_params(params)?;
                call_browser_host(
                    host,
                    BrowserHostOperation::AnnotationDelete,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::BrowserAction => {
                let request: BrowserActionRequest = parse_params(params)?;
                call_browser_host(host, BrowserHostOperation::Action, to_value(request)?).await
            }
            DesktopMethod::PluginInstall => {
                let request: PluginPayloadRequest = parse_params(params)?;
                self.runtime.install_plugin(&to_value(request.plugin)?)
            }
            DesktopMethod::PluginUninstall => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .uninstall_plugin(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::PluginIndustryActivate => {
                let request: PluginPayloadRequest = parse_params(params)?;
                self.runtime
                    .activate_industry_plugin(&to_value(request.plugin)?)
            }
            DesktopMethod::PluginIndustryDeactivate => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .deactivate_industry_plugin(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::PluginMcpReload => {
                parse_empty(params)?;
                self.runtime.reload_mcp()
            }
            DesktopMethod::PluginCatalogSync => {
                let request: PluginCatalogSyncRequest = parse_params(params)?;
                self.runtime
                    .sync_plugin_catalog(&json!({ "url": request.url }))
                    .await
            }
            DesktopMethod::ConnectorOauthStart => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .start_connector_oauth(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::ConnectorOauthComplete => {
                let request: ConnectorOauthCompleteRequest = parse_params(params)?;
                self.runtime
                    .complete_connector_oauth(&to_value(request)?)
                    .await
            }
            DesktopMethod::ConnectorDisconnect => {
                let request: PluginIdRequest = parse_params(params)?;
                self.runtime
                    .disconnect_connector(&json!({ "pluginId": request.plugin_id }))
            }
            DesktopMethod::ProviderGet => {
                let request: ProviderRequest = parse_params(params)?;
                to_value(self.runtime.provider(request)?)
            }
            DesktopMethod::ProviderSave => {
                let request: SaveProviderRequest = parse_params(params)?;
                to_value(self.runtime.save_provider(request)?)
            }
            DesktopMethod::ModelsDiscover => {
                parse_empty(params)?;
                let catalog: ModelCatalog = parse_result(self.runtime.discover_models()?)?;
                to_value(catalog)
            }
            DesktopMethod::ModelsValidate => {
                let request: ModelValidationRequest = parse_params(params)?;
                let result: ModelValidation =
                    parse_result(self.runtime.validate_model(&to_value(request)?)?)?;
                to_value(result)
            }
            DesktopMethod::ExtensionsList => {
                let request: ExtensionsListRequest = parse_params(params)?;
                let snapshot: ExtensionsSnapshot =
                    parse_result(self.runtime.extensions(request.cwd.as_deref())?)?;
                to_value(snapshot)
            }
            DesktopMethod::ExtensionsSkillSetEnabled => {
                let request: SkillEnabledRequest = parse_params(params)?;
                let state: SkillEnabledState =
                    parse_result(self.runtime.set_skill_enabled(&to_value(request)?)?)?;
                to_value(state)
            }
            DesktopMethod::PolicyGet => {
                parse_empty(params)?;
                let state: PolicyState = parse_result(self.runtime.policy_state()?)?;
                to_value(state)
            }
            DesktopMethod::PolicySave => {
                let PolicySaveRequest {
                    thread_id: _,
                    policy,
                } = parse_params(params)?;
                to_value(self.runtime.save_policy(to_value(policy)?).await?)
            }
            DesktopMethod::ConfigEffective => {
                let request: EffectiveConfigRequest = parse_params(params)?;
                let config: EffectiveConfig =
                    parse_result(self.runtime.effective_config(request.cwd.as_deref())?)?;
                to_value(config)
            }
            DesktopMethod::UsageGet => {
                parse_empty(params)?;
                let usage: UsageSnapshot = parse_result(self.runtime.usage_snapshot()?)?;
                to_value(usage)
            }
            DesktopMethod::UsagePriceSave => {
                let request: UsagePriceRequest = parse_params(params)?;
                let usage: UsageSnapshot =
                    parse_result(self.runtime.save_usage_price(&request.key, request.price)?)?;
                to_value(usage)
            }
            DesktopMethod::MemoryList => {
                let request: MemoryListRequest = parse_params(params)?;
                let state: MemoryState = parse_result(
                    self.runtime
                        .memory_state(request.cwd.as_deref(), request.thread_id.as_deref())?,
                )?;
                to_value(state)
            }
            DesktopMethod::MemorySave => {
                let request: MemorySaveRequest = parse_params(params)?;
                let saved: MemorySaveResult = parse_result(
                    self.runtime
                        .save_memory(&request.entry, request.thread_id.as_deref())?,
                )?;
                to_value(saved)
            }
            DesktopMethod::MemoryDelete => {
                let request: MemoryDeleteRequest = parse_params(params)?;
                self.runtime.delete_memory(&request.memory_id)
            }
            DesktopMethod::MemorySettingsSave => {
                let request: MemorySettingsRequest = parse_params(params)?;
                self.runtime.save_memory_settings(&request.settings)
            }
            DesktopMethod::SecretList => {
                parse_empty(params)?;
                to_value(SecretList {
                    secrets: self.runtime.list_secrets()?,
                })
            }
            DesktopMethod::SecretSave => {
                let request: SecretSaveRequest = parse_params(params)?;
                let saved: SecretSaveResult =
                    parse_result(self.runtime.save_secret(&request.secret)?)?;
                to_value(saved)
            }
            DesktopMethod::SecretDelete => {
                let request: SecretDeleteRequest = parse_params(params)?;
                let deleted: SecretDeleteResult =
                    parse_result(self.runtime.delete_secret(&request.secret_id)?)?;
                to_value(deleted)
            }
            DesktopMethod::HookList | DesktopMethod::HookLocalList => {
                let local = method == DesktopMethod::HookLocalList;
                let request: HookListRequest = parse_params(params)?;
                let hooks: Vec<HookDefinition> =
                    parse_result(self.runtime.list_hooks(&request.cwd, local)?)?;
                to_value(hooks)
            }
            DesktopMethod::HookCreate => {
                let request: HookCreateRequest = parse_params(params)?;
                let hook: HookDefinition =
                    parse_result(self.runtime.create_hook(&to_value(request)?)?)?;
                to_value(hook)
            }
            DesktopMethod::ShellActivateDeepLinks => {
                parse_empty(params)?;
                call_shell_host::<Vec<String>>(
                    host,
                    ShellHostOperation::ActivateDeepLinks,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellFrontendReady => {
                parse_empty(params)?;
                call_shell_host::<()>(host, ShellHostOperation::FrontendReady, json!({})).await
            }
            DesktopMethod::ShellOpenTaskWindow => {
                let request: ShellOpenTaskWindowRequest = parse_params(params)?;
                call_shell_host::<()>(host, ShellHostOperation::OpenTaskWindow, to_value(request)?)
                    .await
            }
            DesktopMethod::ShellRequestMicrophoneAccess => {
                parse_empty(params)?;
                call_shell_host::<ShellMicrophoneAccess>(
                    host,
                    ShellHostOperation::RequestMicrophoneAccess,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellOpenCloudConsole => {
                parse_empty(params)?;
                call_shell_host::<ShellOpenedUrl>(
                    host,
                    ShellHostOperation::OpenCloudConsole,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellOpenExternalUrl => {
                let request: ShellExternalUrlRequest = parse_params(params)?;
                call_shell_host::<ShellOpenedUrl>(
                    host,
                    ShellHostOperation::OpenExternalUrl,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellOpenEditor => {
                let request: ShellEditorOpenRequest = parse_params(params)?;
                call_shell_host::<ShellOpenedPath>(
                    host,
                    ShellHostOperation::OpenEditor,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellOpenLocalArtifact => {
                let request: LocalArtifactRequest = parse_params(params)?;
                call_shell_host::<ShellOpenedPath>(
                    host,
                    ShellHostOperation::OpenLocalArtifact,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellRevealGeneratedImage => {
                let request: ShellGeneratedImageRequest = parse_params(params)?;
                call_shell_host::<ShellGeneratedImageReveal>(
                    host,
                    ShellHostOperation::RevealGeneratedImage,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellCopyGeneratedImage => {
                let request: ShellGeneratedImageRequest = parse_params(params)?;
                call_shell_host::<ShellGeneratedImageCopy>(
                    host,
                    ShellHostOperation::CopyGeneratedImage,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellPickImages => {
                let request: ShellFileSelectionRequest = parse_params(params)?;
                call_shell_host::<ShellFileSelection>(
                    host,
                    ShellHostOperation::PickImages,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellPickAttachments => {
                let request: ShellFileSelectionRequest = parse_params(params)?;
                call_shell_host::<ShellFileSelection>(
                    host,
                    ShellHostOperation::PickAttachments,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellPasteImage => {
                let request: ShellFileSelectionRequest = parse_params(params)?;
                call_shell_host::<ShellFileSelection>(
                    host,
                    ShellHostOperation::PasteImage,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellRevealThread => {
                let request: ShellThreadRequest = parse_params(params)?;
                call_shell_host::<ShellThreadReveal>(
                    host,
                    ShellHostOperation::RevealThread,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellRevealProject => {
                let request: ShellProjectRequest = parse_params(params)?;
                call_shell_host::<ShellOpenedPath>(
                    host,
                    ShellHostOperation::RevealProject,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellPickDownloadDirectory => {
                let request: ShellPickDownloadDirectoryRequest = parse_params(params)?;
                call_shell_host::<Preferences>(
                    host,
                    ShellHostOperation::PickDownloadDirectory,
                    to_value(request)?,
                )
                .await
            }
            DesktopMethod::ShellOpenScheduler => {
                parse_empty(params)?;
                call_shell_host::<SchedulerSnapshot>(
                    host,
                    ShellHostOperation::OpenScheduler,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellAppUpdateState => {
                parse_empty(params)?;
                call_shell_host::<AppUpdateState>(
                    host,
                    ShellHostOperation::AppUpdateState,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellAppUpdateCheck => {
                parse_empty(params)?;
                call_shell_host::<ShellAppUpdateCheck>(
                    host,
                    ShellHostOperation::AppUpdateCheck,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellAppUpdateDownload => {
                parse_empty(params)?;
                call_shell_host::<ShellAppUpdateDownload>(
                    host,
                    ShellHostOperation::AppUpdateDownload,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellAppUpdateInstall => {
                parse_empty(params)?;
                call_shell_host::<ShellAppUpdateInstall>(
                    host,
                    ShellHostOperation::AppUpdateInstall,
                    json!({}),
                )
                .await
            }
            DesktopMethod::ShellAppUpdateOpenDownload => {
                parse_empty(params)?;
                call_shell_host::<ShellOpenedUrl>(
                    host,
                    ShellHostOperation::AppUpdateOpenDownload,
                    json!({}),
                )
                .await
            }
        }
    }
}

async fn call_browser_host(
    host: Option<&dyn DesktopHost>,
    operation: BrowserHostOperation,
    params: Value,
) -> Result<Value, AppError> {
    let host = host.ok_or_else(|| {
        AppError::new(ErrorCode::Unsupported, "当前桌面适配器不支持浏览器宿主能力")
    })?;
    host.browser(operation, params).await
}

async fn call_shell_host<T: DeserializeOwned + Serialize>(
    host: Option<&dyn DesktopHost>,
    operation: ShellHostOperation,
    params: Value,
) -> Result<Value, AppError> {
    let host = host
        .ok_or_else(|| AppError::new(ErrorCode::Unsupported, "当前桌面适配器不支持原生宿主能力"))?;
    let result = host.shell(operation, params).await?;
    to_value(parse_result::<T>(result)?)
}

fn resolve_interaction_thread(
    runtime: &CoreRuntime,
    requested: Option<String>,
) -> Result<String, AppError> {
    requested
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| runtime.runtime_snapshot(None).thread_id)
        .ok_or_else(|| AppError::invalid("没有正在运行的任务"))
}

fn active_task_id(runtime: &CoreRuntime, thread_id: &str) -> Option<String> {
    let snapshot = runtime.runtime_snapshot(None);
    (snapshot.thread_id.as_deref() == Some(thread_id))
        .then_some(snapshot.turn_id)
        .flatten()
}

fn task_snapshot(
    runtime: &CoreRuntime,
    request: TaskSnapshotRequest,
) -> Result<TaskSnapshot, AppError> {
    if request.thread_id.trim().is_empty() {
        return Err(AppError::invalid("缺少 threadId"));
    }
    let runtime_snapshot = runtime.runtime_snapshot(None);
    let is_active_thread =
        runtime_snapshot.thread_id.as_deref() == Some(request.thread_id.as_str());
    let task_id = if is_active_thread {
        runtime_snapshot.turn_id.clone()
    } else {
        None
    };
    let state = if !is_active_thread || task_id.is_none() {
        TaskState::Ready
    } else if let Some(expected) = request.task_id.as_deref() {
        if task_id.as_deref() == Some(expected) {
            task_state(&runtime_snapshot.state)
        } else {
            TaskState::Unknown
        }
    } else {
        task_state(&runtime_snapshot.state)
    };
    Ok(TaskSnapshot {
        task_id,
        thread_id: request.thread_id,
        state,
        queued_messages: runtime_snapshot.queued_messages,
        pending_approvals: runtime_snapshot.pending_approvals,
        last_sequence: runtime.event_cursor(),
    })
}

fn task_state(runtime_state: &str) -> TaskState {
    match runtime_state {
        "working" => TaskState::Running,
        "queued" => TaskState::Queued,
        "waiting-approval" | "waiting-input" | "recovering" => TaskState::Waiting,
        "unavailable" => TaskState::Failed,
        "ready" | "stopped" => TaskState::Ready,
        _ => TaskState::Unknown,
    }
}

fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, AppError> {
    serde_json::from_value(params)
        .map_err(|error| AppError::invalid("桌面 API 参数无效").context("cause", error))
}

fn parse_empty(params: Value) -> Result<(), AppError> {
    let fields: std::collections::BTreeMap<String, Value> = parse_params(params)?;
    if fields.is_empty() {
        Ok(())
    } else {
        Err(AppError::invalid("桌面 API 参数无效"))
    }
}

fn parse_result<T: DeserializeOwned>(result: Value) -> Result<T, AppError> {
    serde_json::from_value(result)
        .map_err(|error| AppError::internal("CoreRuntime 返回了无效结果").context("cause", error))
}

fn to_value(value: impl Serialize) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use onpeople_storage::Storage;
    use serde_json::json;
    use std::{process::Command, sync::Mutex};

    #[derive(Default)]
    struct FakeDesktopHost {
        browser_calls: Mutex<Vec<(BrowserHostOperation, Value)>>,
        shell_calls: Mutex<Vec<(ShellHostOperation, Value)>>,
    }

    impl DesktopHost for FakeDesktopHost {
        fn browser<'a>(
            &'a self,
            operation: BrowserHostOperation,
            params: Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, AppError>> + Send + 'a>>
        {
            Box::pin(async move {
                self.browser_calls
                    .lock()
                    .expect("fake browser calls")
                    .push((operation, params));
                Ok(json!({ "ready": true, "activeTabId": null, "attachedTabs": [] }))
            })
        }

        fn shell<'a>(
            &'a self,
            operation: ShellHostOperation,
            params: Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, AppError>> + Send + 'a>>
        {
            Box::pin(async move {
                self.shell_calls
                    .lock()
                    .expect("fake shell calls")
                    .push((operation, params));
                Ok(json!({ "opened": true, "url": "https://example.com" }))
            })
        }
    }

    #[test]
    fn rejects_invalid_params_without_exposing_payload() {
        let error = parse_params::<RuntimeSnapshotRequest>(json!({ "unknown": true }))
            .expect_err("unknown fields must be rejected");
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(error.message, "桌面 API 参数无效");
    }

    #[tokio::test]
    async fn dispatches_a_versioned_request_to_core_runtime() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "contract-1".to_owned(),
                method: DesktopMethod::PreferencesGet,
                params: json!({}),
            })
            .await;

        assert!(response.ok, "unexpected response: {response:?}");
        assert_eq!(response.request_id, "contract-1");
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value.get("theme"))
                .and_then(Value::as_str),
            Some("system")
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn native_shell_methods_require_and_use_the_host_port() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));
        let request = || DesktopRequest {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            request_id: "shell-open-url-1".to_owned(),
            method: DesktopMethod::ShellOpenExternalUrl,
            params: json!({ "url": "https://example.com" }),
        };

        let unsupported = dispatcher.dispatch(request()).await;
        assert!(!unsupported.ok);
        assert_eq!(
            unsupported.error.as_ref().map(|error| error.code),
            Some(ErrorCode::Unsupported)
        );

        let host = FakeDesktopHost::default();
        let response = dispatcher.dispatch_with_host(request(), &host).await;
        assert!(response.ok, "unexpected response: {response:?}");
        {
            let calls = host.shell_calls.lock().expect("fake shell calls");
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, ShellHostOperation::OpenExternalUrl);
            assert_eq!(calls[0].1, json!({ "url": "https://example.com" }));
        }

        let cloud_console = dispatcher
            .dispatch_with_host(
                DesktopRequest {
                    protocol_version: DESKTOP_PROTOCOL_VERSION,
                    request_id: "shell-cloud-console-1".to_owned(),
                    method: DesktopMethod::ShellOpenCloudConsole,
                    params: json!({}),
                },
                &host,
            )
            .await;
        assert!(cloud_console.ok, "unexpected response: {cloud_console:?}");
        {
            let calls = host.shell_calls.lock().expect("fake shell calls");
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[1].0, ShellHostOperation::OpenCloudConsole);
            assert_eq!(calls[1].1, json!({}));
        }
        runtime.stop().await;
    }

    #[tokio::test]
    async fn browser_methods_require_and_use_the_host_port() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));
        let request = || DesktopRequest {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            request_id: "browser-action-1".to_owned(),
            method: DesktopMethod::BrowserAction,
            params: json!({
                "action": "navigate",
                "payload": {
                    "tabId": "tab-1",
                    "url": "https://example.com"
                }
            }),
        };

        let unsupported = dispatcher.dispatch(request()).await;
        assert!(!unsupported.ok);
        assert_eq!(
            unsupported.error.as_ref().map(|error| error.code),
            Some(ErrorCode::Unsupported)
        );

        let host = FakeDesktopHost::default();
        let response = dispatcher.dispatch_with_host(request(), &host).await;
        assert!(response.ok, "unexpected response: {response:?}");
        {
            let calls = host.browser_calls.lock().expect("fake browser calls");
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, BrowserHostOperation::Action);
            assert_eq!(
                calls[0].1,
                json!({
                    "action": "navigate",
                    "payload": {
                        "tabId": "tab-1",
                        "url": "https://example.com"
                    }
                })
            );
        }

        runtime.stop().await;
    }

    #[tokio::test]
    async fn task_snapshot_is_ready_for_an_inactive_thread() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-snapshot-1".to_owned(),
                method: DesktopMethod::TaskSnapshot,
                params: json!({ "threadId": "thread-1", "taskId": null }),
            })
            .await;

        assert!(response.ok, "unexpected response: {response:?}");
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value.get("state"))
                .and_then(Value::as_str),
            Some("ready")
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn event_replay_rejects_zero_limit_and_reports_an_empty_window() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let rejected = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "replay-zero".to_owned(),
                method: DesktopMethod::EventReplay,
                params: json!({ "afterSequence": 0, "limit": 0 }),
            })
            .await;
        assert!(!rejected.ok);
        assert_eq!(
            rejected.error.as_ref().map(|error| error.code),
            Some(ErrorCode::InvalidRequest)
        );

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "replay-empty".to_owned(),
                method: DesktopMethod::EventReplay,
                params: json!({ "afterSequence": 0, "limit": null }),
            })
            .await;
        assert!(response.ok, "unexpected response: {response:?}");
        let replay: EventReplay = serde_json::from_value(response.result.expect("replay result"))
            .expect("typed replay result");
        assert!(replay.events.is_empty());
        assert_eq!(replay.latest_sequence, 0);
        assert_eq!(replay.next_sequence, 0);
        assert!(!replay.requires_snapshot);
        assert!(!replay.has_more);
        runtime.stop().await;
    }

    #[tokio::test]
    async fn task_queue_and_delete_use_typed_contracts() {
        let temporary = tempfile::tempdir().expect("temporary data root");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let queued = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-queue-1".to_owned(),
                method: DesktopMethod::TaskQueue,
                params: json!({ "threadId": "thread-1", "text": "继续检查" }),
            })
            .await;
        assert!(queued.ok, "unexpected response: {queued:?}");
        let queued: QueuedTaskMessage =
            serde_json::from_value(queued.result.expect("queue result"))
                .expect("typed queue result");
        assert_eq!(queued.thread_id, "thread-1");
        assert_eq!(queued.text, "继续检查");

        let deleted = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "task-queue-delete-1".to_owned(),
                method: DesktopMethod::TaskQueueDelete,
                params: json!({ "threadId": "thread-1", "queueId": queued.id }),
            })
            .await;
        assert!(deleted.ok, "unexpected response: {deleted:?}");
        assert_eq!(
            deleted
                .result
                .as_ref()
                .and_then(|value| value.get("deleted"))
                .and_then(Value::as_bool),
            Some(true)
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn dispatches_file_preview_and_rejects_workspace_escape() {
        let temporary = tempfile::tempdir().expect("temporary workspace");
        std::fs::write(temporary.path().join("hello.md"), "# hello").expect("write fixture");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let response = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "file-preview-1".to_owned(),
                method: DesktopMethod::FilePreview,
                params: json!({
                    "cwd": temporary.path(),
                    "path": "hello.md",
                }),
            })
            .await;
        assert!(response.ok, "unexpected response: {response:?}");
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value["kind"].as_str()),
            Some("text")
        );
        assert_eq!(
            response
                .result
                .as_ref()
                .and_then(|value| value["content"].as_str()),
            Some("# hello")
        );

        let escaped = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "file-preview-escape".to_owned(),
                method: DesktopMethod::FilePreview,
                params: json!({
                    "cwd": temporary.path(),
                    "path": "../outside.md",
                }),
            })
            .await;
        assert!(!escaped.ok);
        runtime.stop().await;
    }

    #[tokio::test]
    async fn dispatches_git_initialize_and_state_through_stable_methods() {
        let temporary = tempfile::tempdir().expect("temporary workspace");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));
        let cwd = temporary.path().to_string_lossy();

        let initialized = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "git-init-1".to_owned(),
                method: DesktopMethod::GitInitialize,
                params: json!({ "cwd": cwd }),
            })
            .await;
        assert!(initialized.ok, "unexpected response: {initialized:?}");
        assert_eq!(
            initialized
                .result
                .as_ref()
                .and_then(|value| value["repository"].as_bool()),
            Some(true)
        );

        let state = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "git-state-1".to_owned(),
                method: DesktopMethod::GitState,
                params: json!({ "cwd": cwd }),
            })
            .await;
        assert!(state.ok, "unexpected response: {state:?}");
        runtime.stop().await;
    }

    #[tokio::test]
    async fn dispatches_conversation_project_and_agent_domains_without_shell_commands() {
        let temporary = tempfile::tempdir().expect("temporary workspace");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let pending = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "thread-new-pending".to_owned(),
                method: DesktopMethod::ThreadNew,
                params: json!({ "cwd": null }),
            })
            .await;
        assert!(pending.ok, "unexpected response: {pending:?}");
        assert_eq!(
            pending
                .result
                .as_ref()
                .and_then(|value| value["pending"].as_bool()),
            Some(true)
        );

        let project = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "project-update".to_owned(),
                method: DesktopMethod::ProjectUpdate,
                params: json!({
                    "projectPath": temporary.path(),
                    "action": "pin",
                    "value": true,
                }),
            })
            .await;
        assert!(project.ok, "unexpected response: {project:?}");
        assert_eq!(
            project
                .result
                .as_ref()
                .and_then(|value| value["pinned"].as_bool()),
            Some(true)
        );

        let agents = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "agent-list".to_owned(),
                method: DesktopMethod::AgentList,
                params: json!({ "parentThreadId": null }),
            })
            .await;
        assert!(agents.ok, "unexpected response: {agents:?}");
        assert_eq!(
            agents
                .result
                .as_ref()
                .and_then(|value| value["agents"].as_array())
                .map(Vec::len),
            Some(0)
        );

        let context = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "context-state".to_owned(),
                method: DesktopMethod::ContextState,
                params: json!({ "threadId": null }),
            })
            .await;
        assert!(context.ok, "unexpected response: {context:?}");
        assert!(
            context
                .result
                .as_ref()
                .is_some_and(|value| value.get("snapshot").is_some())
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn worktree_snapshot_rejects_unsafe_outputs_and_keeps_safe_default() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let worktree = temporary.path().join("worktree");
        std::fs::create_dir(&worktree).expect("worktree directory");
        for args in [
            vec!["init"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            assert!(
                Command::new("git")
                    .args(args)
                    .current_dir(&worktree)
                    .status()
                    .expect("git command")
                    .success()
            );
        }
        std::fs::write(worktree.join("README.md"), "initial\n").expect("initial file");
        assert!(
            Command::new("git")
                .args(["add", "README.md"])
                .current_dir(&worktree)
                .status()
                .expect("git add")
                .success()
        );
        assert!(
            Command::new("git")
                .args(["commit", "-m", "initial"])
                .current_dir(&worktree)
                .status()
                .expect("git commit")
                .success()
        );

        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let absolute = temporary.path().join("outside.patch");
        for (request_id, output) in [
            ("snapshot-absolute", absolute.to_string_lossy().into_owned()),
            ("snapshot-traversal", "../outside.patch".to_owned()),
        ] {
            let response = dispatcher
                .dispatch(DesktopRequest {
                    protocol_version: DESKTOP_PROTOCOL_VERSION,
                    request_id: request_id.to_owned(),
                    method: DesktopMethod::WorktreeSnapshot,
                    params: json!({ "worktreePath": worktree, "output": output }),
                })
                .await;
            assert!(!response.ok, "unsafe output was accepted: {response:?}");
            assert_eq!(
                response.error.as_ref().map(|error| error.code),
                Some(ErrorCode::WorkspaceBoundary)
            );
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            symlink(&absolute, worktree.join("linked.patch")).expect("symlink snapshot target");
            let response = dispatcher
                .dispatch(DesktopRequest {
                    protocol_version: DESKTOP_PROTOCOL_VERSION,
                    request_id: "snapshot-symlink".to_owned(),
                    method: DesktopMethod::WorktreeSnapshot,
                    params: json!({ "worktreePath": worktree, "output": "linked.patch" }),
                })
                .await;
            assert!(!response.ok, "symlink output was accepted: {response:?}");
            assert_eq!(
                response.error.as_ref().map(|error| error.code),
                Some(ErrorCode::WorkspaceBoundary)
            );
        }

        std::fs::write(worktree.join("README.md"), "changed\n").expect("changed file");
        let valid = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "snapshot-default".to_owned(),
                method: DesktopMethod::WorktreeSnapshot,
                params: json!({ "worktreePath": worktree }),
            })
            .await;
        assert!(valid.ok, "default output failed: {valid:?}");
        assert_eq!(
            valid
                .result
                .as_ref()
                .and_then(|value| value["path"].as_str()),
            worktree
                .canonicalize()
                .expect("canonical worktree")
                .join(".onpeople.snapshot.patch")
                .to_str()
        );
        assert!(worktree.join(".onpeople.snapshot.patch").is_file());
        runtime.stop().await;
    }

    #[tokio::test]
    async fn dispatches_scheduler_cloud_and_live_controls_without_a_shell_host() {
        let temporary = tempfile::tempdir().expect("temporary workspace");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let created = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "scheduler-create".to_owned(),
                method: DesktopMethod::SchedulerCreate,
                params: json!({
                    "name": "每日检查",
                    "prompt": "检查状态",
                    "cwd": temporary.path(),
                    "schedule": { "kind": "interval", "seconds": 3600 },
                    "runtime": null,
                }),
            })
            .await;
        assert!(created.ok, "unexpected response: {created:?}");
        let task_id = created
            .result
            .as_ref()
            .and_then(|value| value["id"].as_str())
            .expect("created task id")
            .to_owned();

        let from_text = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "scheduler-create-from-text".to_owned(),
                method: DesktopMethod::SchedulerCreateFromText,
                params: json!({
                    "name": null,
                    "prompt": null,
                    "text": "整理今天的工作",
                    "cwd": temporary.path(),
                    "schedule": null,
                    "runtime": null,
                }),
            })
            .await;
        assert!(from_text.ok, "unexpected response: {from_text:?}");
        assert_eq!(
            from_text
                .result
                .as_ref()
                .and_then(|value| value["schedule"]["kind"].as_str()),
            Some("once")
        );

        let deleted = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "scheduler-delete".to_owned(),
                method: DesktopMethod::SchedulerDelete,
                params: json!({ "id": task_id }),
            })
            .await;
        assert!(deleted.ok, "unexpected response: {deleted:?}");
        assert_eq!(deleted.result.and_then(|value| value.as_bool()), Some(true));

        let account = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "cloud-account".to_owned(),
                method: DesktopMethod::CloudAccount,
                params: json!({}),
            })
            .await;
        assert!(account.ok, "unexpected response: {account:?}");
        assert_eq!(
            account
                .result
                .as_ref()
                .and_then(|value| value["signedIn"].as_bool()),
            Some(false)
        );

        let live = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "live-status".to_owned(),
                method: DesktopMethod::LiveStatus,
                params: json!({}),
            })
            .await;
        assert!(live.ok, "unexpected response: {live:?}");
        assert!(
            live.result
                .as_ref()
                .is_some_and(|value| value.get("available").is_some())
        );
        runtime.stop().await;
    }

    #[tokio::test]
    async fn dispatches_config_data_without_shell_or_storage_access() {
        let temporary = tempfile::tempdir().expect("temporary workspace");
        let storage =
            Storage::open_empty(temporary.path().join("data")).expect("open empty storage");
        let runtime = Arc::new(
            CoreRuntime::new(storage, temporary.path().join("runtime"))
                .expect("create core runtime"),
        );
        let dispatcher = DesktopDispatcher::new(Arc::clone(&runtime));

        let policy = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "policy-get-1".to_owned(),
                method: DesktopMethod::PolicyGet,
                params: json!({}),
            })
            .await;
        assert!(policy.ok, "unexpected response: {policy:?}");
        assert_eq!(
            policy
                .result
                .as_ref()
                .and_then(|value| value["policy"]["sandbox"].as_str()),
            Some("workspace-write")
        );

        let config = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "config-effective-1".to_owned(),
                method: DesktopMethod::ConfigEffective,
                params: json!({ "cwd": temporary.path() }),
            })
            .await;
        assert!(config.ok, "unexpected response: {config:?}");
        assert_eq!(
            config
                .result
                .as_ref()
                .and_then(|value| value["source"].as_str()),
            Some("onpeople.db")
        );

        let usage = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "usage-price-1".to_owned(),
                method: DesktopMethod::UsagePriceSave,
                params: json!({ "key": "input", "price": 0.25 }),
            })
            .await;
        assert!(usage.ok, "unexpected response: {usage:?}");
        assert_eq!(
            usage
                .result
                .as_ref()
                .and_then(|value| value["prices"]["input"].as_f64()),
            Some(0.25)
        );

        let hooks = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "hooks-list-1".to_owned(),
                method: DesktopMethod::HookLocalList,
                params: json!({ "cwd": temporary.path() }),
            })
            .await;
        assert!(hooks.ok, "unexpected response: {hooks:?}");
        assert!(
            hooks
                .result
                .as_ref()
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        );

        let created_hook = dispatcher
            .dispatch(DesktopRequest {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                request_id: "hook-create-compatible-1".to_owned(),
                method: DesktopMethod::HookCreate,
                params: json!({
                    "cwd": temporary.path(),
                    "event": { "kind": "turn.completed", "attempt": 2 },
                    "command": ["npm", "test"],
                }),
            })
            .await;
        assert!(created_hook.ok, "unexpected response: {created_hook:?}");
        assert_eq!(
            created_hook.result,
            Some(json!({
                "id": "hook",
                "path": null,
                "local": null,
                "event": { "kind": "turn.completed", "attempt": 2 },
                "command": ["npm", "test"],
                "enabled": true,
            }))
        );
        let persisted_hook =
            std::fs::read_to_string(temporary.path().join(".onpeople/hooks/hook.json"))
                .expect("persisted hook");
        assert_eq!(
            serde_json::from_str::<Value>(&persisted_hook).expect("hook json"),
            json!({
                "id": "hook",
                "event": { "kind": "turn.completed", "attempt": 2 },
                "command": ["npm", "test"],
                "enabled": true,
            })
        );
        runtime.stop().await;
    }

    #[test]
    fn maps_runtime_states_to_stable_task_states() {
        assert_eq!(task_state("working"), TaskState::Running);
        assert_eq!(task_state("waiting-approval"), TaskState::Waiting);
        assert_eq!(task_state("queued"), TaskState::Queued);
        assert_eq!(task_state("unexpected"), TaskState::Unknown);
    }
}
