document.addEventListener('DOMContentLoaded', () => {
    const logos    = ["º/º", "º/-", "-/º", "-/-"];
    const variants = ["º/-", "-/º"];           // wink/peek variants
    const logoEl   = document.querySelector('.logo');
    const sleepEl  = document.querySelector('.sleep');
  
    const MIN_BLINK = 5000;    //  5s
    const MAX_BLINK = 10000;   // 10s
    const MIN_DELAY = 5000;    //  5s mid-cycle
    const MAX_DELAY = 25000;   // 25s mid-cycle
    const CYCLE     = 30000;   // 30s per face
  
    // 1️⃣ INITIAL LOAD: base face
    let currentFace = logos[0];  // "º/º"
    logoEl.textContent = currentFace;
    sleepEl.style.display = "none";
  
    // 2️⃣ INITIAL WINK: after random 5–10s
    setTimeout(() => {
      const sneak = variants[Math.floor(Math.random() * variants.length)];
      logoEl.textContent = sneak;
      setTimeout(() => {
        logoEl.textContent = currentFace;
      }, 400);
    }, MIN_BLINK + Math.random() * (MAX_BLINK - MIN_BLINK));
  
    // 3️⃣ START the random-mood cycle
    setInterval(() => {
      // pick a random face
      currentFace = logos[Math.floor(Math.random() * logos.length)];
      logoEl.textContent = currentFace;
      sleepEl.style.display = currentFace === "-/-" ? "flex" : "none";
  
      // schedule a mid-cycle wink/peek
      setTimeout(() => {
        const sneakMid = variants[Math.floor(Math.random() * variants.length)];
        logoEl.textContent = sneakMid;
        setTimeout(() => {
          logoEl.textContent = currentFace;
          sleepEl.style.display = currentFace === "-/-" ? "flex" : "none";
        }, 1000);
      }, MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
  
    }, CYCLE);
  });
  