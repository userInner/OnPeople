use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use onpeople_storage::Storage;
use onpeople_types::{AppError, ScheduledRun, ScheduledTask, SchedulerSnapshot};
use parking_lot::Mutex;
use serde_json::Value;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone)]
pub struct SchedulerService {
    storage: Storage,
    tasks: Arc<Mutex<HashMap<String, ScheduledTask>>>,
    runs: Arc<Mutex<Vec<ScheduledRun>>>,
    updates: broadcast::Sender<SchedulerSnapshot>,
}

impl SchedulerService {
    #[must_use]
    pub fn new(storage: Storage) -> Self {
        let (updates, _) = broadcast::channel(128);
        let service = Self {
            storage,
            tasks: Arc::new(Mutex::new(HashMap::new())),
            runs: Arc::new(Mutex::new(Vec::new())),
            updates,
        };
        if let Ok(Some(value)) = service.storage.get_metadata("scheduler") {
            if let Ok(snapshot) = serde_json::from_value::<SchedulerSnapshot>(value) {
                service.tasks.lock().extend(
                    snapshot
                        .tasks
                        .into_iter()
                        .map(|task| (task.id.clone(), task)),
                );
                *service.runs.lock() = snapshot.runs;
            }
        }
        service
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<SchedulerSnapshot> {
        self.updates.subscribe()
    }

    #[must_use]
    pub fn snapshot(&self) -> SchedulerSnapshot {
        let mut tasks = self.tasks.lock().values().cloned().collect::<Vec<_>>();
        tasks.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let runs = self.runs.lock().clone();
        let unread = runs.iter().filter(|run| run.unread).count() as u32;
        SchedulerSnapshot {
            tasks,
            runs,
            unread,
        }
    }

    pub fn create(
        &self,
        name: String,
        prompt: String,
        cwd: String,
        schedule: Value,
        runtime: Value,
    ) -> Result<ScheduledTask, AppError> {
        if name.trim().is_empty() || prompt.trim().is_empty() || cwd.trim().is_empty() {
            return Err(AppError::invalid("计划任务名称、提示词和工作目录不能为空"));
        }
        let now = Utc::now();
        let next_run_at = next_run(&schedule, now);
        let task = ScheduledTask {
            id: Uuid::now_v7().to_string(),
            name: name.trim().chars().take(100).collect(),
            prompt: prompt.trim().chars().take(20_000).collect(),
            cwd: cwd.trim().to_owned(),
            enabled: true,
            schedule,
            runtime,
            next_run_at,
            created_at: now,
            updated_at: now,
        };
        self.tasks.lock().insert(task.id.clone(), task.clone());
        self.persist_snapshot()?;
        Ok(task)
    }

    pub fn update(&self, id: &str, patch: Value) -> Result<ScheduledTask, AppError> {
        let mut tasks = self.tasks.lock();
        let task = tasks
            .get_mut(id)
            .ok_or_else(|| AppError::new(onpeople_types::ErrorCode::NotFound, "计划任务不存在"))?;
        if let Some(name) = patch.get("name").and_then(Value::as_str) {
            if name.trim().is_empty() {
                return Err(AppError::invalid("计划任务名称不能为空"));
            }
            task.name = name.trim().chars().take(100).collect();
        }
        if let Some(prompt) = patch.get("prompt").and_then(Value::as_str) {
            if prompt.trim().is_empty() {
                return Err(AppError::invalid("计划任务提示词不能为空"));
            }
            task.prompt = prompt.trim().chars().take(20_000).collect();
        }
        if let Some(cwd) = patch.get("cwd").and_then(Value::as_str) {
            if cwd.trim().is_empty() {
                return Err(AppError::invalid("计划任务工作目录不能为空"));
            }
            task.cwd = cwd.trim().to_owned();
        }
        if let Some(runtime) = patch.get("runtime") {
            task.runtime = runtime.clone();
        }
        if let Some(enabled) = patch.get("enabled").and_then(Value::as_bool) {
            task.enabled = enabled;
            if enabled && patch.get("schedule").is_none() {
                task.next_run_at = next_run(&task.schedule, Utc::now());
            }
        }
        if let Some(schedule) = patch.get("schedule") {
            task.schedule = schedule.clone();
            task.next_run_at = next_run(schedule, Utc::now());
        }
        task.updated_at = Utc::now();
        let result = task.clone();
        drop(tasks);
        self.persist_snapshot()?;
        Ok(result)
    }

    pub fn delete(&self, id: &str) -> Result<bool, AppError> {
        let removed = self.tasks.lock().remove(id).is_some();
        if removed {
            self.persist_snapshot()?;
        }
        Ok(removed)
    }

    pub fn mark_read(&self, run_id: Option<&str>) -> Result<(), AppError> {
        for run in &mut *self.runs.lock() {
            if run_id.is_none() || run_id == Some(run.id.as_str()) {
                run.unread = false;
            }
        }
        self.persist_snapshot()
    }

    pub fn run_now(&self, id: &str) -> Result<ScheduledRun, AppError> {
        if !self.tasks.lock().contains_key(id) {
            return Err(AppError::new(
                onpeople_types::ErrorCode::NotFound,
                "计划任务不存在",
            ));
        }
        let run = ScheduledRun {
            id: Uuid::now_v7().to_string(),
            task_id: id.to_owned(),
            status: "queued".to_owned(),
            started_at: Utc::now(),
            finished_at: None,
            thread_id: None,
            message: None,
            unread: false,
        };
        let mut runs = self.runs.lock();
        runs.insert(0, run.clone());
        runs.truncate(200);
        drop(runs);
        self.persist_snapshot()?;
        Ok(run)
    }

    pub fn claim_due(&self, now: DateTime<Utc>) -> Result<Vec<ScheduledTask>, AppError> {
        let mut tasks = self.tasks.lock();
        let mut due = Vec::new();
        for task in tasks.values_mut() {
            if !task.enabled || task.next_run_at.is_none_or(|next| next > now) {
                continue;
            }
            due.push(task.clone());
            if task.schedule.get("kind").and_then(Value::as_str) == Some("once") {
                task.enabled = false;
                task.next_run_at = None;
            } else {
                task.next_run_at = next_run(&task.schedule, now);
            }
            task.updated_at = now;
        }
        drop(tasks);
        due.sort_by(|left, right| left.id.cmp(&right.id));
        if !due.is_empty() {
            self.persist_snapshot()?;
        }
        Ok(due)
    }

    pub fn task(&self, id: &str) -> Option<ScheduledTask> {
        self.tasks.lock().get(id).cloned()
    }

    pub fn start_run(
        &self,
        run_id: &str,
        thread_id: String,
        turn_id: String,
    ) -> Result<(), AppError> {
        let mut runs = self.runs.lock();
        let run = runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| AppError::new(onpeople_types::ErrorCode::NotFound, "计划运行不存在"))?;
        run.status = "running".to_owned();
        run.thread_id = Some(thread_id);
        run.message = Some(turn_id);
        run.finished_at = None;
        run.unread = false;
        drop(runs);
        self.persist_snapshot()
    }

    pub fn finish_thread_run(
        &self,
        thread_id: &str,
        status: &str,
        message: Option<String>,
    ) -> Result<bool, AppError> {
        let mut runs = self.runs.lock();
        let Some(run) = runs
            .iter_mut()
            .find(|run| run.status == "running" && run.thread_id.as_deref() == Some(thread_id))
        else {
            return Ok(false);
        };
        run.status = status.to_owned();
        run.message = message;
        run.finished_at = Some(Utc::now());
        run.unread = true;
        drop(runs);
        self.persist_snapshot()?;
        Ok(true)
    }

    pub fn finish_run(
        &self,
        run_id: &str,
        status: &str,
        thread_id: Option<String>,
        message: Option<String>,
    ) -> Result<(), AppError> {
        let mut runs = self.runs.lock();
        let run = runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| AppError::new(onpeople_types::ErrorCode::NotFound, "计划运行不存在"))?;
        run.status = status.to_owned();
        run.thread_id = thread_id;
        run.message = message;
        run.finished_at = Some(Utc::now());
        run.unread = true;
        drop(runs);
        self.persist_snapshot()
    }

    fn persist_snapshot(&self) -> Result<(), AppError> {
        let snapshot = self.snapshot();
        self.storage.put_metadata(
            "scheduler",
            &serde_json::to_value(&snapshot).map_err(AppError::internal)?,
        )?;
        let _ = self.updates.send(snapshot);
        Ok(())
    }
}

fn next_run(schedule: &Value, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if let Some(interval) = schedule.get("intervalMinutes").and_then(Value::as_u64) {
        return Some(now + chrono::Duration::minutes(interval.max(1) as i64));
    }
    if schedule.get("kind").and_then(Value::as_str) == Some("once") {
        return schedule
            .get("at")
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
    }
    Some(now + chrono::Duration::days(1))
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use onpeople_storage::Storage;
    use serde_json::json;
    use tempfile::tempdir;

    use super::SchedulerService;

    fn scheduler() -> SchedulerService {
        let directory = tempdir().expect("temporary scheduler directory");
        let path = directory.keep();
        let storage = Storage::open_empty(path).expect("temporary scheduler storage");
        SchedulerService::new(storage)
    }

    #[test]
    fn claims_a_one_time_task_only_once() {
        let scheduler = scheduler();
        let now = Utc::now();
        let task = scheduler
            .create(
                "Once".to_owned(),
                "Run once".to_owned(),
                "/tmp/project".to_owned(),
                json!({ "kind": "once", "at": (now - Duration::minutes(1)).to_rfc3339() }),
                json!({ "mode": "local" }),
            )
            .expect("create task");

        let due = scheduler.claim_due(now).expect("claim due task");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, task.id);
        assert!(scheduler.claim_due(now).expect("claim again").is_empty());

        let stored = scheduler.task(&task.id).expect("stored task");
        assert!(!stored.enabled);
        assert!(stored.next_run_at.is_none());
    }

    #[test]
    fn advances_an_interval_before_the_task_is_dispatched() {
        let scheduler = scheduler();
        let now = Utc::now();
        let task = scheduler
            .create(
                "Interval".to_owned(),
                "Run repeatedly".to_owned(),
                "/tmp/project".to_owned(),
                json!({ "kind": "interval", "intervalMinutes": 5 }),
                json!({}),
            )
            .expect("create task");
        let due_at = now + Duration::minutes(6);

        assert_eq!(scheduler.claim_due(due_at).expect("claim").len(), 1);
        assert!(scheduler.claim_due(due_at).expect("claim again").is_empty());
        assert!(
            scheduler
                .task(&task.id)
                .expect("stored task")
                .next_run_at
                .is_some_and(|next| next > due_at)
        );
    }

    #[test]
    fn tracks_a_run_until_the_agent_turn_finishes() {
        let scheduler = scheduler();
        let task = scheduler
            .create(
                "Run".to_owned(),
                "Do work".to_owned(),
                "/tmp/project".to_owned(),
                json!({ "kind": "interval", "intervalMinutes": 60 }),
                json!({}),
            )
            .expect("create task");
        let run = scheduler.run_now(&task.id).expect("queue run");
        assert!(!run.unread);

        scheduler
            .start_run(&run.id, "thread-1".to_owned(), "turn-1".to_owned())
            .expect("start run");
        scheduler
            .finish_thread_run("thread-1", "completed", Some("计划任务已完成".to_owned()))
            .expect("finish run");

        let snapshot = scheduler.snapshot();
        assert_eq!(snapshot.unread, 1);
        assert_eq!(snapshot.runs[0].status, "completed");
        assert!(snapshot.runs[0].finished_at.is_some());
        scheduler.mark_read(None).expect("mark read");
        assert_eq!(scheduler.snapshot().unread, 0);
    }
}
