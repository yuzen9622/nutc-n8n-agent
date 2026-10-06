FROM pgvector/pgvector:0.8.2-pg17-trixie@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75
COPY --chmod=644 infra/db/init.sh /docker-entrypoint-initdb.d/10-campus.sh
