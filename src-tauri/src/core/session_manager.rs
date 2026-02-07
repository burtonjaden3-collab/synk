use std::collections::HashMap;

use anyhow::{anyhow, Result};

use crate::core::process_pool::{ProcessPool, SharedProcessPool};

pub struct SessionManager {
    pool: SharedProcessPool,
    next_session_id: usize,
    // In Phase 1.2 we only track ownership. The actual PTY I/O + resize will be
    // implemented in Task 1.3.
    sessions: HashMap<usize, SessionRecord>,
}

struct SessionRecord {
    session_id: usize,
}

impl SessionManager {
    pub fn new(pool: SharedProcessPool) -> Self {
        Self {
            pool,
            next_session_id: 1,
            sessions: HashMap::new(),
        }
    }

    pub fn create_session(&mut self) -> Result<usize> {
        let session_id = self.next_session_id;
        self.next_session_id += 1;

        if self.sessions.contains_key(&session_id) {
            return Err(anyhow!("duplicate session id {session_id}"));
        }

        ProcessPool::claim(self.pool.clone(), session_id)?;
        self.sessions
            .insert(session_id, SessionRecord { session_id });
        Ok(session_id)
    }

    pub fn destroy_session(&mut self, session_id: usize) -> Result<()> {
        let _rec = self
            .sessions
            .remove(&session_id)
            .ok_or_else(|| anyhow!("unknown session_id {session_id}"))?;
        ProcessPool::release(self.pool.clone(), session_id)?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<usize> {
        self.sessions.keys().copied().collect()
    }
}
