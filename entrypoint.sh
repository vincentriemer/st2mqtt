#!/usr/bin/env bash

set -e

args=()

if [ -n "$MQTT_URL" ]; then
  args+=("--mqtt_url" "$MQTT_URL")
fi

if [ -n "$DEVICE_ID" ]; then
  args+=("--unique_id" "$DEVICE_ID")
fi

if [ -n "$MQTT_USERNAME" ]; then
  args+=("--mqtt_username" "$MQTT_USERNAME")
fi

if [ -n "$MQTT_PASSWORD" ]; then
  args+=("--mqtt_password" "$MQTT_PASSWORD")
fi

bun run server.ts ${args[@]}