module.exports = {
  exists(val) {
    return (typeof val !== 'undefined' && val !== null);
  },
};
