# Multi-device telemetry fast path

Work scope: preserve every device history while incrementally merging only the device that submitted telemetry, retry optimistic conflicts once, and retain the durable D1 scan solely as recovery for missing or malformed state.
