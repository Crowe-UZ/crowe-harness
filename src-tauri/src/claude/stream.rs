//! `claude -p --output-format stream-json` (NDJSON) → [`TurnEvent`] mapping.
//!
//! Pure and synchronous so it can be unit-tested line by line. Unknown or
//! malformed lines are ignored. Events of subagents (records carrying a
//! non-null `parent_tool_use_id`) are not forwarded to the main chat.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

use serde::Serialize;
use serde_json::Value;

use super::history::{TOOL_INPUT_MAX, TOOL_RESULT_MAX};
use super::records::tool_result_text;
use crate::util::truncate_marked;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Success,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TurnEvent {
    SessionStarted {
        session_id: String,
        model: Option<String>,
    },
    MessageStart {
        message_id: String,
    },
    TextDelta {
        message_id: String,
        text: String,
    },
    ToolCallStart {
        id: String,
        message_id: String,
        name: String,
        input: String,
    },
    ToolCallEnd {
        id: String,
        status: ToolStatus,
        output: String,
    },
    SubagentStarted {
        tool_use_id: String,
        agent_type: Option<String>,
        description: Option<String>,
    },
    MessageEnd {
        message_id: String,
        stop_reason: StopReason,
        usage: Option<TurnUsage>,
    },
    PermissionDenied {
        tool_name: String,
        tool_use_id: String,
    },
    Error {
        message: String,
    },
    Exit {
        code: Option<i32>,
    },
}

/// Max length of an error message forwarded to the UI.
pub const ERROR_MAX: usize = 2000;

#[derive(Debug, Default)]
pub struct StreamMapper {
    session_announced: bool,
    open_message: Option<String>,
    started: HashSet<String>,
    /// Message ids whose text arrived as `text_delta` stream events.
    delta_streamed: HashSet<String>,
    /// (message id, hash of text) already emitted from full assistant records.
    emitted_text: HashSet<(String, u64)>,
    tool_ids: HashSet<String>,
    local_ids: u32,
    got_result: bool,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|x| !x.is_empty())
        .map(str::to_owned)
}

fn u(v: Option<&Value>, key: &str) -> u64 {
    v.and_then(|v| v.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn hash_text(t: &str) -> u64 {
    let mut h = DefaultHasher::new();
    t.hash(&mut h);
    h.finish()
}

impl StreamMapper {
    pub fn got_result(&self) -> bool {
        self.got_result
    }

    pub fn open_message(&self) -> Option<&str> {
        self.open_message.as_deref()
    }

    /// Maps one stdout line to zero or more events.
    pub fn handle_line(&mut self, line: &str) -> Vec<TurnEvent> {
        let mut out = Vec::new();
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            return out;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            return out;
        };
        if v.get("parent_tool_use_id").is_some_and(|p| !p.is_null()) {
            return out; // subagent internals
        }
        match v.get("type").and_then(Value::as_str) {
            Some("system") => self.on_system(&v, &mut out),
            Some("stream_event") => self.on_stream_event(&v, &mut out),
            Some("assistant") => self.on_assistant(&v, &mut out),
            Some("user") => self.on_user(&v, &mut out),
            Some("result") => self.on_result(&v, &mut out),
            _ => {}
        }
        out
    }

    /// Events to emit when the turn is cancelled.
    pub fn interrupt(&mut self) -> Vec<TurnEvent> {
        self.close_open(StopReason::Interrupted, None)
            .into_iter()
            .collect()
    }

    /// Events to emit when stdout ended: a message still open (no `result`)
    /// is settled as interrupted.
    pub fn finish(&mut self) -> Vec<TurnEvent> {
        self.interrupt()
    }

    fn close_open(&mut self, reason: StopReason, usage: Option<TurnUsage>) -> Option<TurnEvent> {
        self.open_message
            .take()
            .map(|message_id| TurnEvent::MessageEnd {
                message_id,
                stop_reason: reason,
                usage,
            })
    }

    /// Makes `id` the open message; ends the previous one (end_turn).
    fn start_message(&mut self, id: &str, out: &mut Vec<TurnEvent>) {
        if self.open_message.as_deref() == Some(id) {
            return;
        }
        if self.started.contains(id) {
            return; // a late record of an already finished message
        }
        out.extend(self.close_open(StopReason::EndTurn, None));
        self.started.insert(id.to_owned());
        self.open_message = Some(id.to_owned());
        out.push(TurnEvent::MessageStart {
            message_id: id.to_owned(),
        });
    }

    fn current_or_new(&mut self, out: &mut Vec<TurnEvent>) -> String {
        if let Some(id) = &self.open_message {
            return id.clone();
        }
        self.local_ids += 1;
        let id = format!("local-msg-{}", self.local_ids);
        self.start_message(&id, out);
        id
    }

    fn announce(
        &mut self,
        session_id: Option<String>,
        model: Option<String>,
        out: &mut Vec<TurnEvent>,
    ) {
        if self.session_announced {
            return;
        }
        if let Some(session_id) = session_id {
            self.session_announced = true;
            out.push(TurnEvent::SessionStarted { session_id, model });
        }
    }

    fn on_system(&mut self, v: &Value, out: &mut Vec<TurnEvent>) {
        if v.get("subtype").and_then(Value::as_str) == Some("init") {
            self.announce(s(v, "session_id"), s(v, "model"), out);
        }
    }

    fn on_stream_event(&mut self, v: &Value, out: &mut Vec<TurnEvent>) {
        let Some(event) = v.get("event") else { return };
        match event.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                let id = event.get("message").and_then(|m| s(m, "id"));
                match id {
                    Some(id) => self.start_message(&id, out),
                    None => {
                        self.current_or_new(out);
                    }
                }
            }
            Some("content_block_delta") => {
                let Some(delta) = event.get("delta") else {
                    return;
                };
                if delta.get("type").and_then(Value::as_str) != Some("text_delta") {
                    return;
                }
                let Some(text) = delta.get("text").and_then(Value::as_str) else {
                    return;
                };
                if text.is_empty() {
                    return;
                }
                let message_id = self.current_or_new(out);
                self.delta_streamed.insert(message_id.clone());
                out.push(TurnEvent::TextDelta {
                    message_id,
                    text: text.to_owned(),
                });
            }
            _ => {} // message_stop & co: the end comes from the next message or the result
        }
    }

    fn on_assistant(&mut self, v: &Value, out: &mut Vec<TurnEvent>) {
        let Some(msg) = v.get("message") else { return };
        let id = match s(msg, "id") {
            Some(id) => {
                self.start_message(&id, out);
                id
            }
            None => self.current_or_new(out),
        };
        let Some(blocks) = msg.get("content").and_then(Value::as_array) else {
            return;
        };
        for b in blocks {
            match b.get("type").and_then(Value::as_str) {
                Some("text") => {
                    // Without partial-message events, the text arrives here.
                    if self.delta_streamed.contains(&id) {
                        continue;
                    }
                    let Some(text) = b.get("text").and_then(Value::as_str) else {
                        continue;
                    };
                    if text.is_empty() || !self.emitted_text.insert((id.clone(), hash_text(text))) {
                        continue;
                    }
                    out.push(TurnEvent::TextDelta {
                        message_id: id.clone(),
                        text: text.to_owned(),
                    });
                }
                Some("tool_use") => {
                    let Some(tool_id) = s(b, "id") else { continue };
                    if !self.tool_ids.insert(tool_id.clone()) {
                        continue;
                    }
                    let name = s(b, "name").unwrap_or_default();
                    let input = b.get("input").cloned().unwrap_or(Value::Null);
                    out.push(TurnEvent::ToolCallStart {
                        id: tool_id.clone(),
                        message_id: id.clone(),
                        name: name.clone(),
                        input: truncate_marked(&input.to_string(), TOOL_INPUT_MAX),
                    });
                    if name == "Task" || name == "Agent" {
                        out.push(TurnEvent::SubagentStarted {
                            tool_use_id: tool_id,
                            agent_type: s(&input, "subagent_type"),
                            description: s(&input, "description"),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    fn on_user(&mut self, v: &Value, out: &mut Vec<TurnEvent>) {
        let Some(blocks) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            return;
        };
        for b in blocks {
            if b.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let Some(id) = s(b, "tool_use_id") else {
                continue;
            };
            let is_error = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            out.push(TurnEvent::ToolCallEnd {
                id,
                status: if is_error {
                    ToolStatus::Error
                } else {
                    ToolStatus::Success
                },
                output: truncate_marked(&tool_result_text(b.get("content")), TOOL_RESULT_MAX),
            });
        }
    }

    fn on_result(&mut self, v: &Value, out: &mut Vec<TurnEvent>) {
        self.got_result = true;
        self.announce(s(v, "session_id"), None, out);
        if let Some(denials) = v.get("permission_denials").and_then(Value::as_array) {
            for d in denials {
                out.push(TurnEvent::PermissionDenied {
                    tool_name: s(d, "tool_name").unwrap_or_default(),
                    tool_use_id: s(d, "tool_use_id").unwrap_or_default(),
                });
            }
        }
        let usage_v = v.get("usage");
        let usage = TurnUsage {
            input_tokens: u(usage_v, "input_tokens")
                + u(usage_v, "cache_creation_input_tokens")
                + u(usage_v, "cache_read_input_tokens"),
            output_tokens: u(usage_v, "output_tokens"),
            cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
        };
        let has_usage = usage_v.is_some() || usage.cost_usd.is_some();
        out.extend(self.close_open(StopReason::EndTurn, has_usage.then_some(usage)));
        if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
            let message = s(v, "result")
                .or_else(|| {
                    v.get("errors")
                        .and_then(Value::as_array)
                        .and_then(|e| e.first())
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .or_else(|| {
                    s(v, "subtype").map(|st| format!("Claude Code reported an error ({st})"))
                })
                .unwrap_or_else(|| "Claude Code reported an error".to_owned());
            out.push(TurnEvent::Error {
                message: truncate_marked(&message, ERROR_MAX),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lines: &[&str]) -> (StreamMapper, Vec<TurnEvent>) {
        let mut m = StreamMapper::default();
        let mut out = Vec::new();
        for l in lines {
            out.extend(m.handle_line(l));
        }
        (m, out)
    }

    #[test]
    fn full_turn_with_partial_messages() {
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"sess-1","model":"claude-opus-4","tools":[]}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_1","usage":{}}},"session_id":"sess-1","parent_tool_use_id":null}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{"}}}"#,
            r#"{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":"Hello"}]},"parent_tool_use_id":null}"#,
            r#"{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{"subagent_type":"Explore","description":"Look around","prompt":"p"}}]}}"#,
            r#"{"type":"assistant","message":{"id":"msg_1","content":[{"type":"tool_use","id":"toolu_1","name":"Task","input":{}}]}}"#,
            r#"{"type":"stream_event","event":{"type":"message_stop"}}"#,
            r#"{"type":"assistant","message":{"id":"msg_sub","content":[{"type":"text","text":"subagent says"}]},"parent_tool_use_id":"toolu_1"}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"report"}]}]},"parent_tool_use_id":null}"#,
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_2"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Done."}}}"#,
            r#"not json at all"#,
            r#"{"type":"something_new","x":1}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","session_id":"sess-1","total_cost_usd":0.0123,"usage":{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":100,"output_tokens":42},"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_9","tool_input":{}}]}"#,
        ];
        let (m, events) = run(&lines);
        assert!(m.got_result());
        let expected = vec![
            TurnEvent::SessionStarted {
                session_id: "sess-1".into(),
                model: Some("claude-opus-4".into()),
            },
            TurnEvent::MessageStart { message_id: "msg_1".into() },
            TurnEvent::TextDelta { message_id: "msg_1".into(), text: "Hel".into() },
            TurnEvent::TextDelta { message_id: "msg_1".into(), text: "lo".into() },
            TurnEvent::ToolCallStart {
                id: "toolu_1".into(),
                message_id: "msg_1".into(),
                name: "Task".into(),
                // Key order depends on serde_json's `preserve_order` feature.
                input: serde_json::json!({"subagent_type":"Explore","description":"Look around","prompt":"p"})
                    .to_string(),
            },
            TurnEvent::SubagentStarted {
                tool_use_id: "toolu_1".into(),
                agent_type: Some("Explore".into()),
                description: Some("Look around".into()),
            },
            TurnEvent::ToolCallEnd {
                id: "toolu_1".into(),
                status: ToolStatus::Success,
                output: "report".into(),
            },
            TurnEvent::MessageEnd {
                message_id: "msg_1".into(),
                stop_reason: StopReason::EndTurn,
                usage: None,
            },
            TurnEvent::MessageStart { message_id: "msg_2".into() },
            TurnEvent::TextDelta { message_id: "msg_2".into(), text: "Done.".into() },
            TurnEvent::PermissionDenied {
                tool_name: "Bash".into(),
                tool_use_id: "toolu_9".into(),
            },
            TurnEvent::MessageEnd {
                message_id: "msg_2".into(),
                stop_reason: StopReason::EndTurn,
                usage: Some(TurnUsage {
                    input_tokens: 115,
                    output_tokens: 42,
                    cost_usd: Some(0.0123),
                }),
            },
        ];
        assert_eq!(events, expected);
    }

    #[test]
    fn without_partial_messages_text_comes_from_assistant_records() {
        let (_, events) = run(&[
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hi"}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Hi"}]}}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"there"}]}}"#,
        ]);
        assert_eq!(
            events,
            vec![
                TurnEvent::MessageStart {
                    message_id: "m1".into()
                },
                TurnEvent::TextDelta {
                    message_id: "m1".into(),
                    text: "Hi".into()
                },
                TurnEvent::TextDelta {
                    message_id: "m1".into(),
                    text: "there".into()
                },
            ]
        );
    }

    #[test]
    fn error_result_and_interrupt() {
        let (mut m, events) = run(&[
            r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1"}}}"#,
            r#"{"type":"result","subtype":"error_during_execution","is_error":true,"session_id":"s2"}"#,
        ]);
        assert_eq!(
            events,
            vec![
                TurnEvent::MessageStart {
                    message_id: "m1".into()
                },
                TurnEvent::SessionStarted {
                    session_id: "s2".into(),
                    model: None
                },
                TurnEvent::MessageEnd {
                    message_id: "m1".into(),
                    stop_reason: StopReason::EndTurn,
                    usage: None
                },
                TurnEvent::Error {
                    message: "Claude Code reported an error (error_during_execution)".into()
                },
            ]
        );
        assert!(m.interrupt().is_empty(), "nothing open after result");

        let (mut m, _) = run(&[
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}}"#,
        ]);
        assert_eq!(m.open_message(), Some("local-msg-1"));
        assert_eq!(
            m.interrupt(),
            vec![TurnEvent::MessageEnd {
                message_id: "local-msg-1".into(),
                stop_reason: StopReason::Interrupted,
                usage: None
            }]
        );
    }

    #[test]
    fn tool_error_and_serialization_shape() {
        let (_, events) = run(&[
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"boom","is_error":true}]}}"#,
        ]);
        let json = serde_json::to_value(&events[0]).expect("json");
        assert_eq!(
            json,
            serde_json::json!({"type":"tool_call_end","id":"t1","status":"error","output":"boom"})
        );
        let json = serde_json::to_value(TurnEvent::MessageEnd {
            message_id: "m".into(),
            stop_reason: StopReason::EndTurn,
            usage: Some(TurnUsage {
                input_tokens: 1,
                output_tokens: 2,
                cost_usd: None,
            }),
        })
        .expect("json");
        assert_eq!(
            json,
            serde_json::json!({"type":"message_end","messageId":"m","stopReason":"end_turn",
                "usage":{"inputTokens":1,"outputTokens":2,"costUsd":null}})
        );
        let json = serde_json::to_value(TurnEvent::Exit { code: None }).expect("json");
        assert_eq!(json, serde_json::json!({"type":"exit","code":null}));
    }
}
