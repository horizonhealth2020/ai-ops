CREATE TABLE faq_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  category VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faq_embeddings_client ON faq_embeddings(client_id);
CREATE INDEX idx_faq_embeddings_vector ON faq_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
