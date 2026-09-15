#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout server.key -out server.crt -days 3650 \
  -subj "/C=US/ST=Illinois/L=Chicago/O=node-express-session/CN=express-session.local"
