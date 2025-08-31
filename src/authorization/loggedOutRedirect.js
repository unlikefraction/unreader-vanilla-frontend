// authRedirect.js
(function() {
    /**
     * Read a cookie by name.
     * @param {string} name
     * @returns {string|null}
     */
    function getCookie(name) {
      const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    }
  
    const token = getCookie('authToken');
  
    // If there’s *no* token, send ’em to login.
    if (!token) {
      window.location.replace('/');
    }
  })();
  