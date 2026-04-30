#!/usr/bin/env bash
set -o errexit

# 1. Install Node dependencies
npm ci --include=dev --legacy-peer-deps

# 2. Build the frontend
npm run build
