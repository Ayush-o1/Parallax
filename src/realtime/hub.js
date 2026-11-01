'use strict';

let io;

function attach(socketServer) { io = socketServer; }

function publish(organizationId, event, payload) {
  if (io) io.to(`organization:${organizationId}`).emit(event, payload);
}

module.exports = { attach, publish };
