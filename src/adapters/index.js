'use strict';

const adapters = {
  OEM_ALPHA: require('./alpha.adapter'),
  OEM_BETA: require('./beta.adapter'),
  OEM_GAMMA: require('./gamma.adapter'),
};

function forSource(source) {
  return adapters[source] || null;
}

module.exports = { forSource, adapters };
