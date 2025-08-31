// ----------------------------
// Cookie helpers
// ----------------------------
function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days*24*60*60*1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }
  
  function getCookie(name) {
    const pairs = document.cookie ? document.cookie.split(/;\s*/) : [];
    for (const p of pairs) {
      const idx = p.indexOf("=");
      if (idx === -1) continue;
      const k = decodeURIComponent(p.slice(0, idx));
      if (k === name) return decodeURIComponent(p.slice(idx + 1));
    }
    return null;
  }
  
  
  function deleteCookie(name) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
  
  // ----------------------------
  // Utilities
  // ----------------------------
  function printl(...a){ try{ console.log(...a); }catch(_){} }
  function printError(...a){ try{ console.error(...a); }catch(_){} }
  
  // Title-case each word (keeps internal spacing sane)
  function toTitleCase(str){
    return str
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }
  
  // Enable/disable submit button
  function toggleSubmitButton() {
    const input = document.querySelector('.nameInput');
    const btn = document.querySelector('.submitButton');
    btn.disabled = input.value.trim().length === 0;
  }
  
  // Load credit (if some other script hasn’t already)
  function setCreditsUI(amount){
    const el = document.querySelector('.creditAmount');
    if (el) el.textContent = Number(amount ?? 0).toFixed(2);
  }
  
  // ----------------------------
  // API calls
  // ----------------------------
  async function loadUserInfo() {
    const token = getCookie('authToken');
    const url = `${window.API_URLS.USER}info/`;
  
    // If logged-out, just wire up the UI
    if (!token) {
      toggleSubmitButton();
      return;
    }
  
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
  
      if (res.ok) {
        const user = await res.json();
        const input = document.querySelector('.nameInput');
  
        if (user?.name) input.value = user.name;
        if (typeof user?.credits === 'number') setCreditsUI(user.credits);
  
        // Make sure first letters are caps visually
        input.value = toTitleCase(input.value || '');
      } else {
        printError('Failed to fetch user info:', res.status);
      }
    } catch (err) {
      printError('Error fetching user info:', err);
    } finally {
      toggleSubmitButton();
    }
  }
  
  async function updateUserInfo(name) {
    const token = getCookie('authToken');
    const url = `${window.API_URLS.USER}update/`;
  
    // If not logged in, we still allow anonymous update (per your earlier flow)
    let res = await fetch(url, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        token ? { 'Authorization': `Bearer ${token}` } : {}
      ),
      body: JSON.stringify({ name })
    });
  
    if (res.status === 401 && token) {
      printError('⚠️ Token unauthorized. Deleting credentials and retrying anonymously.');
      deleteCookie('authToken');
  
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ name })
      });
    }
  
    if (!res.ok) {
      throw new Error(`Failed to update user: ${res.status} ${res.statusText}`);
    }
  
    const data = await res.json();
  
    // Set onboarding cookie if not set
    const onboardingStatus = getCookie('onboardingComplete');
    if (onboardingStatus !== 'true') {
      setCookie('onboardingComplete', 'true');
      printl('🎉 onboardingComplete cookie set.');
    }
  
    return data;
  }
  
  // ----------------------------
  // Event wiring
  // ----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('.nameInput');
    const btn = document.querySelector('.submitButton');
  
    // Prefill/credits
    loadUserInfo();
  
    // Button enable/disable
    input.addEventListener('input', () => {
      // Live “first letter caps” for first character of each word if user types lowercase
      // but don’t be annoying: only normalize when they put a space or at blur/submit
      toggleSubmitButton();
    });
  
    // Normalize nicely on blur
    input.addEventListener('blur', () => {
      input.value = toTitleCase(input.value);
    });
  
    // Enter key submits
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) {
        btn.click();
      }
    });
  
    // Submit
    btn.addEventListener('click', async () => {
      const name = toTitleCase(input.value);
      if (!name) return;
  
      try {
        await updateUserInfo(name);
        window.location.href = '/home.html';
      } catch (err) {
        printError('❌ Error updating user:', err);
        alert('Something went wrong. Please try again.');
      }
    });
  });
  