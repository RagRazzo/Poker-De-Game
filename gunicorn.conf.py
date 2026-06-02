import eventlet
eventlet.monkey_patch()

import os

# Cloud Run injects PORT at runtime (default 8080).
# Reading it here in Python avoids all shell variable-expansion issues.
bind = "0.0.0.0:" + os.environ.get("PORT", "8080")
worker_class = "eventlet"
workers = 1
timeout = 300
keepalive = 65
# Trust Cloud Run's load balancer for real client IPs
forwarded_allow_ips = "*"
