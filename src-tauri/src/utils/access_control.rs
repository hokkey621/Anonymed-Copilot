use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::utils::path_guard::{ensure_path_allowed, ensure_within_dir, SimpleGitignore};

#[derive(Debug)]
pub struct AccessSnapshot {
    pub base_dir: PathBuf,
    pub gitignore: Option<Arc<SimpleGitignore>>,
}

impl AccessSnapshot {
    pub fn ensure_allowed(&self, path: &Path) -> Result<PathBuf, String> {
        ensure_path_allowed(path, &self.base_dir, self.gitignore.as_deref())
    }

    pub fn ensure_within_base(&self, path: &Path) -> Result<PathBuf, String> {
        ensure_within_dir(path, &self.base_dir)
    }

    pub fn is_ignored(&self, path: &Path) -> bool {
        self.gitignore
            .as_ref()
            .map(|gitignore| gitignore.is_ignored(&self.base_dir, path))
            .unwrap_or(false)
    }
}

#[derive(Debug, Default)]
struct AccessControlState {
    base_dir: Option<PathBuf>,
    gitignore: Option<Arc<SimpleGitignore>>,
}

#[derive(Debug, Default)]
pub struct AccessControl {
    state: Mutex<AccessControlState>,
}

impl AccessControl {
    pub fn set_base_dir(&self, base_dir: PathBuf) -> Result<(), String> {
        let gitignore = SimpleGitignore::from_file(&base_dir).map(Arc::new)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Access control state is locked".to_string())?;
        state.base_dir = Some(base_dir);
        state.gitignore = Some(gitignore);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<AccessSnapshot, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Access control state is locked".to_string())?;
        let base_dir = state
            .base_dir
            .clone()
            .ok_or_else(|| "Base directory is not set".to_string())?;
        Ok(AccessSnapshot {
            base_dir,
            gitignore: state.gitignore.clone(),
        })
    }

    pub fn ensure_allowed(&self, path: &Path) -> Result<PathBuf, String> {
        let snapshot = self.snapshot()?;
        snapshot.ensure_allowed(path)
    }
}
