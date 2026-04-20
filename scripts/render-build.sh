#!/usr/bin/env bash
set -e

echo "==> Installing MongoDB Database Tools..."
mkdir -p bin
curl -sSL -o mdbtools.tgz "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.10.0.tgz"
tar -xzf mdbtools.tgz
cp mongodb-database-tools-*/bin/mongodump mongodb-database-tools-*/bin/mongorestore bin/
chmod +x bin/mongodump bin/mongorestore
rm -rf mdbtools.tgz mongodb-database-tools-*
echo "==> mongodump installed at $(pwd)/bin/mongodump"

echo "==> Building NestJS app..."
npm run build
