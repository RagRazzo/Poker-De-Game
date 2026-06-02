import eventlet
eventlet.monkey_patch()   # must be first — before any other import

import os
from app import socketio, app

port = int(os.environ.get("PORT", 8080))
socketio.run(app, host="0.0.0.0", port=port, debug=False, log_output=True)
