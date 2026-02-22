use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatPhase {
    Discovery,
    Help,
    PurposeSelection,
    PlanPresented,
    ExecutionReady,
    Revision,
    Troubleshoot,
    OffTopic,
}
