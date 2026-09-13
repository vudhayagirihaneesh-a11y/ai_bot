-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create documents table (metadata for each uploaded file)
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create document_chunks table (stores the actual text and embeddings)
create table if not exists public.document_chunks (
  id text primary key, -- we generate explicit chunk IDs in the app
  doc_id uuid references public.documents(id) on delete cascade not null,
  doc_name text not null,
  page integer,
  chunk_index integer not null,
  text text not null,
  embedding vector(768) not null -- nomic-embed-text uses 768 dimensions
);

-- 4. Create an index for faster similarity search
create index on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- 5. Create a function to search for similar chunks
create or replace function match_chunks (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_doc_ids uuid[] default null
)
returns table (
  id text,
  doc_id uuid,
  doc_name text,
  page integer,
  chunk_index integer,
  text text,
  similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.doc_id,
    document_chunks.doc_name,
    document_chunks.page,
    document_chunks.chunk_index,
    document_chunks.text,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
    and (filter_doc_ids is null or document_chunks.doc_id = any(filter_doc_ids))
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- 6. Storage bucket for uploads
insert into storage.buckets (id, name, public) 
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- 7. Ensure anon users can upload and read from the bucket (since app has no auth right now)
create policy "Allow anon users to read and insert documents (Dev only)" 
on storage.objects for all 
to anon 
using (bucket_id = 'documents')
with check (bucket_id = 'documents');
