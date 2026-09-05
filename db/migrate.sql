ALTER TABLE concepts ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES concepts(id);
ALTER TABLE target_topics ADD COLUMN IF NOT EXISTS concept_id INT REFERENCES concepts(id);
ALTER TABLE target_topics ALTER COLUMN mastery SET DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'seed';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT;

CREATE TABLE IF NOT EXISTS revision_sessions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES learning_targets(id) ON DELETE CASCADE,
  mode VARCHAR(30) NOT NULL CHECK (mode IN ('complete','topic')),
  topic_concept_id INT REFERENCES concepts(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  question_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS revision_session_topics (
  session_id INT NOT NULL REFERENCES revision_sessions(id) ON DELETE CASCADE,
  concept_id INT NOT NULL REFERENCES concepts(id),
  asked_count INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY(session_id, concept_id)
);

CREATE INDEX IF NOT EXISTS questions_concept_idx ON questions(concept_id);
CREATE INDEX IF NOT EXISTS target_topics_target_idx ON target_topics(target_id);
CREATE INDEX IF NOT EXISTS knowledge_states_user_updated_idx ON knowledge_states(user_id, updated_at DESC);

UPDATE target_topics tt
SET concept_id = c.id
FROM concepts c
WHERE tt.concept_id IS NULL
  AND c.name = tt.topic_name
  AND c.parent_id IS NULL;

UPDATE target_topics SET mastery=0 WHERE mastery IS NULL;
