use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct CancellationState {
    chat_cancelled: AtomicBool,
    bulk_cancelled: AtomicBool,
}

impl CancellationState {
    pub fn request_chat_cancel(&self) {
        self.chat_cancelled.store(true, Ordering::SeqCst);
    }

    pub fn request_bulk_cancel(&self) {
        self.bulk_cancelled.store(true, Ordering::SeqCst);
    }

    pub fn reset_chat(&self) {
        self.chat_cancelled.store(false, Ordering::SeqCst);
    }

    pub fn reset_bulk(&self) {
        self.bulk_cancelled.store(false, Ordering::SeqCst);
    }

    pub fn is_chat_cancelled(&self) -> bool {
        self.chat_cancelled.load(Ordering::SeqCst)
    }

    pub fn is_bulk_cancelled(&self) -> bool {
        self.bulk_cancelled.load(Ordering::SeqCst)
    }
}
