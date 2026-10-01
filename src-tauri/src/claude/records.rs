//! Lenient serde models of Claude Code transcript (JSONL) records.
//!
//! Only the fields the app needs are declared; everything else (including
//! large tool results in the summary pass) is skipped without allocation.
//! Type mismatches never fail a line: "lenient" fields fall back to `None`.

use std::fmt;
use std::marker::PhantomData;

use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::Value;

/// A string if the JSON value is a string, otherwise `None`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LStr(pub Option<String>);

impl LStr {
    pub fn get(&self) -> Option<&str> {
        self.0.as_deref()
    }
    pub fn non_empty(&self) -> Option<&str> {
        self.0.as_deref().filter(|s| !s.trim().is_empty())
    }
}

impl<'de> Deserialize<'de> for LStr {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = LStr;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("any value")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<LStr, E> {
                Ok(LStr(Some(v.to_owned())))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<LStr, E> {
                Ok(LStr(Some(v)))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_unit<E: de::Error>(self) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_none<E: de::Error>(self) -> Result<LStr, E> {
                Ok(LStr(None))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<LStr, A::Error> {
                while s.next_element::<IgnoredAny>()?.is_some() {}
                Ok(LStr(None))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<LStr, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(LStr(None))
            }
        }
        d.deserialize_any(V)
    }
}

/// `true` only if the JSON value is `true`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LBool(pub bool);

impl<'de> Deserialize<'de> for LBool {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = IgnoredOrBool::deserialize(d)?;
        Ok(LBool(v.0))
    }
}

struct IgnoredOrBool(bool);
impl<'de> Deserialize<'de> for IgnoredOrBool {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = IgnoredOrBool;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("any value")
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(v))
            }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_unit<E: de::Error>(self) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_none<E: de::Error>(self) -> Result<IgnoredOrBool, E> {
                Ok(IgnoredOrBool(false))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<IgnoredOrBool, A::Error> {
                while s.next_element::<IgnoredAny>()?.is_some() {}
                Ok(IgnoredOrBool(false))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<IgnoredOrBool, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(IgnoredOrBool(false))
            }
        }
        d.deserialize_any(V)
    }
}

/// `message.content`: a plain string or an array of blocks `B`. Anything
/// else (or a block that fails to parse) yields an empty list.
#[derive(Debug, Clone)]
pub enum Content<B> {
    Text(String),
    Blocks(Vec<B>),
}

impl<B> Default for Content<B> {
    fn default() -> Self {
        Content::Blocks(Vec::new())
    }
}

impl<'de, B: Deserialize<'de>> Deserialize<'de> for Content<B> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<B>(PhantomData<B>);
        impl<'de, B: Deserialize<'de>> Visitor<'de> for V<B> {
            type Value = Content<B>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("string or array")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(Content::Text(v.to_owned()))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(Content::Text(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Self::Value, A::Error> {
                let mut out = Vec::new();
                while let Some(item) = s.next_element::<MaybeBlock<B>>()? {
                    if let Some(b) = item.0 {
                        out.push(b);
                    }
                }
                Ok(Content::Blocks(out))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Self::Value, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Content::default())
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
            fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(Content::default())
            }
        }
        d.deserialize_any(V(PhantomData))
    }
}

/// A block that is only kept when it is a JSON object of the right shape.
struct MaybeBlock<B>(Option<B>);

impl<'de, B: Deserialize<'de>> Deserialize<'de> for MaybeBlock<B> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Blocks are objects with lenient fields; anything that is not an
        // object is skipped (no buffering through `Value`).
        struct V<B>(PhantomData<B>);
        impl<'de, B: Deserialize<'de>> Visitor<'de> for V<B> {
            type Value = MaybeBlock<B>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a content block")
            }
            fn visit_map<A: MapAccess<'de>>(self, m: A) -> Result<Self::Value, A::Error> {
                B::deserialize(de::value::MapAccessDeserializer::new(m))
                    .map(|b| MaybeBlock(Some(b)))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Self::Value, A::Error> {
                while s.next_element::<IgnoredAny>()?.is_some() {}
                Ok(MaybeBlock(None))
            }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(MaybeBlock(None))
            }
        }
        d.deserialize_any(V(PhantomData))
    }
}

/// Record header shared by both passes; `B` is the content block model.
#[derive(Debug, Deserialize)]
#[serde(bound = "B: Deserialize<'de>")]
pub struct Record<B> {
    #[serde(rename = "type", default)]
    pub kind: LStr,
    #[serde(default)]
    pub uuid: LStr,
    #[serde(default)]
    pub timestamp: LStr,
    #[serde(rename = "isMeta", default)]
    pub is_meta: LBool,
    #[serde(rename = "isSidechain", default)]
    pub is_sidechain: LBool,
    #[serde(rename = "isCompactSummary", default)]
    pub is_compact_summary: LBool,
    #[serde(default)]
    pub cwd: LStr,
    #[serde(rename = "gitBranch", default)]
    pub git_branch: LStr,
    #[serde(rename = "customTitle", default)]
    pub custom_title: LStr,
    #[serde(rename = "aiTitle", default)]
    pub ai_title: LStr,
    #[serde(default)]
    pub summary: LStr,
    #[serde(default)]
    pub message: Option<Message<B>>,
}

#[derive(Debug, Deserialize)]
#[serde(bound = "B: Deserialize<'de>")]
pub struct Message<B> {
    #[serde(default)]
    pub id: LStr,
    #[serde(default)]
    pub model: LStr,
    #[serde(default)]
    pub content: Option<Content<B>>,
}

/// Summary-pass block: only the type and (for text blocks) the text.
#[derive(Debug, Deserialize)]
pub struct SummaryBlock {
    #[serde(rename = "type", default)]
    pub kind: LStr,
    #[serde(default)]
    pub text: LStr,
}

/// Full-pass block.
#[derive(Debug, Deserialize)]
pub struct FullBlock {
    #[serde(rename = "type", default)]
    pub kind: LStr,
    #[serde(default)]
    pub text: LStr,
    #[serde(default)]
    pub id: LStr,
    #[serde(default)]
    pub name: LStr,
    #[serde(default)]
    pub input: Option<Box<RawValue>>,
    #[serde(default)]
    pub tool_use_id: LStr,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub is_error: LBool,
}

/// Text of a `tool_result.content` (string, or array of text/image blocks).
pub fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => {
            let parts: Vec<String> = items
                .iter()
                .filter_map(|item| match item.get("type").and_then(Value::as_str) {
                    Some("text") => item.get("text").and_then(Value::as_str).map(str::to_owned),
                    Some("image") => Some("[image]".to_owned()),
                    _ => None,
                })
                .collect();
            parts.join("\n")
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_fields_never_fail_a_line() {
        let line = r#"{"type":"user","uuid":5,"timestamp":null,"isMeta":"yes","cwd":{"a":[1,2]},
            "message":{"id":["x"],"content":[{"type":"text","text":"hi"},7,{"type":"image","source":{}}]}}"#;
        let r: Record<SummaryBlock> = serde_json::from_str(line).expect("parsed");
        assert_eq!(r.kind.get(), Some("user"));
        assert_eq!(r.uuid.get(), None);
        assert!(!r.is_meta.0);
        assert_eq!(r.cwd.get(), None);
        let msg = r.message.expect("message");
        assert_eq!(msg.id.get(), None);
        match msg.content.expect("content") {
            Content::Blocks(b) => {
                assert_eq!(b.len(), 2);
                assert_eq!(b[0].text.get(), Some("hi"));
            }
            Content::Text(_) => panic!("expected blocks"),
        }
    }

    #[test]
    fn tool_result_text_variants() {
        let v: Value =
            serde_json::json!([{"type":"text","text":"a"},{"type":"image"},{"type":"other"}]);
        assert_eq!(tool_result_text(Some(&v)), "a\n[image]");
        assert_eq!(tool_result_text(Some(&Value::String("s".into()))), "s");
        assert_eq!(tool_result_text(None), "");
    }
}
