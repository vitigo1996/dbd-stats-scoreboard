/**
 * DEAD BY STATS - SCOREBOARD HUD CALCULATOR LOGIC
 */

// --- VARIABLES DE ESTADO ---
let playersData = [];
let supabaseClient = null;
let realtimeChannel = null;
let presenceChannel = null;

// --- CREDENCIALES POR DEFECTO (HARDCODED) ---
const DEFAULT_SUPABASE_URL = "https://tonbittltrpzgncogcke.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_klpZVv35Pz2juNv9awXMzA_Lt37I9BF";

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  initAtmosphere();
  initCalculator();
});

// --- INICIAR CLIENTE SUPABASE ---
function initSupabase() {
  if (localStorage.getItem("dbd_supabase_disabled") === "true") {
    supabaseClient = null;
    return false;
  }

  const url = localStorage.getItem("dbd_supabase_url") || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem("dbd_supabase_key") || DEFAULT_SUPABASE_KEY;

  if (url && key) {
    try {
      supabaseClient = window.supabase.createClient(url, key);
      return true;
    } catch (e) {
      console.error("Error al instanciar Supabase:", e);
      supabaseClient = null;
    }
  }
  supabaseClient = null;
  return false;
}

// --- CARGAR DATOS (SUPABASE O LOCAL STORAGE) ---
async function loadData() {
  const hasSupabase = initSupabase();

  if (hasSupabase) {
    try {
      const { data, error } = await supabaseClient
        .from("players")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;

      if (data && data.length === 4) {
        playersData = data.map(row => ({
          id: row.id,
          name: row.name,
          stats: {
            moris: row.moris || 0,
            dcs: row.dcs || 0,
            escapes: row.escapes || 0,
            firstDeaths: row.first_deaths || 0,
            bloodpoints: row.bloodpoints || 0,
            history: row.history ? JSON.parse(row.history) : [0]
          }
        }));
        renderCounters();
        subscribeRealtime();
        initViewerPresence();
        showToast("Conectado a Supabase en tiempo real.", "success");
        return;
      } else {
        console.warn("Supabase no contiene exactamente 4 jugadores. Intentando inicializar tabla...");
        await pushAllDataToSupabase();
      }
    } catch (err) {
      console.error("Error al conectar con Supabase. Usando LocalStorage offline.", err);
      showToast("Error de conexión con Supabase. Usando LocalStorage offline.", "info");
    }
  }

  loadFromLocalStorage();
}

function loadFromLocalStorage() {
  const savedData = localStorage.getItem("dbd_calculator_data");
  if (savedData) {
    try {
      playersData = JSON.parse(savedData);
      
      if (!Array.isArray(playersData) || playersData.length !== 4) {
        throw new Error("Invalid structure");
      }

      const isValid = playersData.every(p => p && p.stats && p.stats.history && Array.isArray(p.stats.history) && p.stats.moris !== undefined);
      if (!isValid) {
        throw new Error("Corrupted local structure");
      }

      playersData.forEach((player, idx) => {
        const defaultNames = ["VITIGO", "VINZENT", "JOSEDVA", "MIANCOR"];
        player.name = defaultNames[idx];
        player.id = player.id !== undefined ? player.id : idx;
      });
      saveData();
    } catch (e) {
      initializeDefaultData();
    }
  } else {
    initializeDefaultData();
  }
  renderCounters();
  initViewerPresence();
}

function initializeDefaultData() {
  playersData = [
    { id: 0, name: "VITIGO", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { id: 1, name: "VINZENT", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { id: 2, name: "JOSEDVA", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { id: 3, name: "MIANCOR", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } }
  ];
  saveData();
}

// --- CONTADOR DE VISUALIZACIÓN EN TIEMPO REAL (SUPABASE PRESENCE) ---
function initViewerPresence() {
  if (presenceChannel) {
    try {
      if (supabaseClient) supabaseClient.removeChannel(presenceChannel);
    } catch (e) {}
    presenceChannel = null;
  }

  const display = document.getElementById("viewer-count-display");
  if (!display) return;

  if (!supabaseClient) {
    display.textContent = "🟢 1 Viendo (Local)";
    return;
  }

  try {
    presenceChannel = supabaseClient.channel("online-users", {
      config: { presence: { key: "user" } }
    });

    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        const count = Object.keys(state).length || 1;
        display.textContent = `🟢 ${count} Viendo`;
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });
  } catch (err) {
    console.error("Error al iniciar presencia:", err);
    display.textContent = "🟢 1 Viendo";
  }
}

// --- GUARDAR EN LOCAL STORAGE ---
function saveData() {
  localStorage.setItem("dbd_calculator_data", JSON.stringify(playersData));
}

// --- ACTUALIZAR REGISTROS DE JUGADORES A SUPABASE ---
async function pushAllDataToSupabase() {
  if (!supabaseClient) return;
  try {
    for (let i = 0; i < 4; i++) {
      const p = playersData[i] || { id: i, name: "", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } };
      await supabaseClient.from("players").upsert({
        id: p.id,
        name: p.name,
        moris: p.stats.moris,
        dcs: p.stats.dcs,
        escapes: p.stats.escapes,
        first_deaths: p.stats.firstDeaths,
        bloodpoints: p.stats.bloodpoints,
        history: JSON.stringify(p.stats.history || [0])
      });
    }
  } catch (err) {
    console.error("Error al subir datos iniciales a Supabase:", err);
  }
}

// --- SUSCRIPCIÓN EN TIEMPO REAL (REALTIME DE SUPABASE) ---
function subscribeRealtime() {
  if (!supabaseClient) return;
  
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel("public-players-changes")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "players" },
      payload => {
        const updatedRow = payload.new;
        const idx = playersData.findIndex(p => p.id === updatedRow.id);
        if (idx !== -1) {
          playersData[idx].stats = {
            moris: updatedRow.moris || 0,
            dcs: updatedRow.dcs || 0,
            escapes: updatedRow.escapes || 0,
            firstDeaths: updatedRow.first_deaths || 0,
            bloodpoints: updatedRow.bloodpoints || 0,
            history: updatedRow.history ? JSON.parse(updatedRow.history) : [0]
          };
          renderCounters();
        }
      }
    )
    .subscribe();
}

// --- ENVIAR ACTUALIZACIÓN DE CONTADORES A BASE DE DATOS ---
async function updatePlayerStat(playerIdx, statName, value) {
  if (playersData[playerIdx] && playersData[playerIdx].stats) {
    const p = playersData[playerIdx];
    if (supabaseClient && p.id !== undefined) {
      const dbColName = statName === "firstDeaths" ? "first_deaths" : statName;
      try {
        await supabaseClient
          .from("players")
          .update({ [dbColName]: value })
          .eq("id", p.id);
      } catch (err) {
        console.error("Error actualizando Supabase en vivo:", err);
      }
    } else {
      saveData();
    }
  }
}

// --- AMBIENTE DE LA HOGUERA (BRASAS FLOTANTES) ---
function initAtmosphere() {
  if (window.innerWidth < 820) {
    return;
  }
  const container = document.getElementById("embers-container");
  if (!container) return;

  const initialEmberCount = 15;
  for (let i = 0; i < initialEmberCount; i++) {
    createEmber(container, true);
  }

  setInterval(() => {
    const currentEmbers = container.querySelectorAll(".ember").length;
    if (currentEmbers < 25) {
      createEmber(container, false);
    }
  }, 900);
}

// --- SISTEMA DE AUDIO DEL JUEGO ---
function playAudioFor(statName) {
  try {
    let filename = "";
    if (statName === "moris") filename = "mori.mp3";
    else if (statName === "dcs") filename = "dc.mp3";
    else if (statName === "escapes") filename = "escape.mp3";
    else if (statName === "firstDeaths") filename = "first_death.mp3";

    if (filename) {
      const audio = new Audio(filename);
      audio.volume = 0.5;
      audio.play().catch(() => {});
    }
  } catch (err) {}
}

function createEmber(container, isInitial = false) {
  const ember = document.createElement("div");
  ember.className = "ember";

  const size = Math.random() * 4 + 2;
  const left = Math.random() * 100;
  const duration = Math.random() * 5 + 4;
  const delay = isInitial ? -(Math.random() * duration) : 0;
  const drift = (Math.random() * 80 - 40) + "px";

  ember.style.width = `${size}px`;
  ember.style.height = `${size}px`;
  ember.style.left = `${left}%`;
  ember.style.animationDuration = `${duration}s`;
  ember.style.animationDelay = `${delay}s`;
  ember.style.setProperty("--drift-x", drift);

  container.appendChild(ember);

  setTimeout(() => {
    ember.remove();
  }, (duration + (isInitial ? 0 : delay)) * 1000);
}

// --- ANIMACIÓN FLOTANTE (VUELO) ---
function triggerFlyAnimation(imgSrc, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.top + rect.height / 2;

  const flyIcon = document.createElement("img");
  flyIcon.src = imgSrc;
  flyIcon.className = "floating-fly-icon";
  flyIcon.style.setProperty("--target-x", `${targetX}px`);
  flyIcon.style.setProperty("--target-y", `${targetY}px`);

  document.body.appendChild(flyIcon);

  setTimeout(() => {
    flyIcon.remove();
  }, 850);
}

// --- CONFIGURACIÓN DE LA CALCULADORA Y SCOREBOARD ---
function initCalculator() {
  // 1. Botones de estadísticas interactivos (clic izquierdo suma, clic derecho resta)
  const iconButtons = document.querySelectorAll(".btn-icon-calc");
  iconButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const playerIdx = parseInt(btn.getAttribute("data-player"));
      const statName = btn.getAttribute("data-stat");

      if (playersData[playerIdx] && playersData[playerIdx].stats) {
        const imgSrc = btn.querySelector("img").getAttribute("src");
        const containerId = `val-${playerIdx}-${statName}`;
        triggerFlyAnimation(imgSrc, containerId);

        playersData[playerIdx].stats[statName]++;
        renderCounters();
        playAudioFor(statName);
        
        updatePlayerStat(playerIdx, statName, playersData[playerIdx].stats[statName]);
      }
    });

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const playerIdx = parseInt(btn.getAttribute("data-player"));
      const statName = btn.getAttribute("data-stat");

      if (playersData[playerIdx] && playersData[playerIdx].stats) {
        if (playersData[playerIdx].stats[statName] > 0) {
          playersData[playerIdx].stats[statName]--;
          renderCounters();
          playAudioFor(statName);

          updatePlayerStat(playerIdx, statName, playersData[playerIdx].stats[statName]);
        }
      }
    });
  });

  // 2. Interacción del menú desplegable superior
  const btnOptionsMenu = document.getElementById("btn-options-menu");
  const dropdownMenuContent = document.getElementById("dropdown-menu-content");

  if (btnOptionsMenu && dropdownMenuContent) {
    btnOptionsMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownMenuContent.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!dropdownMenuContent.contains(e.target) && e.target !== btnOptionsMenu) {
        dropdownMenuContent.classList.remove("show");
      }
    });
  }

  // 3. Menú -> Conexión DB (Ajustes Supabase)
  const modalSettings = document.getElementById("settings-modal");
  const btnMenuDb = document.getElementById("btn-menu-db");
  const btnCloseSettings = document.getElementById("btn-settings-close");
  const btnSaveSettings = document.getElementById("btn-settings-save");
  const btnDisconnectSettings = document.getElementById("btn-settings-disconnect");

  const urlInput = document.getElementById("supabase-url-input");
  const keyInput = document.getElementById("supabase-key-input");

  if (btnMenuDb && modalSettings) {
    btnMenuDb.addEventListener("click", () => {
      dropdownMenuContent.classList.remove("show");
      urlInput.value = localStorage.getItem("dbd_supabase_url") || DEFAULT_SUPABASE_URL;
      keyInput.value = localStorage.getItem("dbd_supabase_key") || DEFAULT_SUPABASE_KEY;
      modalSettings.classList.add("show");
    });
  }

  if (btnCloseSettings && modalSettings) {
    btnCloseSettings.addEventListener("click", () => {
      modalSettings.classList.remove("show");
    });
  }

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      const url = urlInput.value.trim();
      const key = keyInput.value.trim();

      if (!url || !key) {
        showToast("Por favor, introduce la URL y Anon Key válidas.", "info");
        return;
      }

      localStorage.removeItem("dbd_supabase_disabled");
      localStorage.setItem("dbd_supabase_url", url);
      localStorage.setItem("dbd_supabase_key", key);
      
      modalSettings.classList.remove("show");
      loadData();
    });
  }

  if (btnDisconnectSettings) {
    btnDisconnectSettings.addEventListener("click", () => {
      localStorage.setItem("dbd_supabase_disabled", "true");
      localStorage.removeItem("dbd_supabase_url");
      localStorage.removeItem("dbd_supabase_key");
      
      urlInput.value = "";
      keyInput.value = "";
      supabaseClient = null;
      if (realtimeChannel) {
        realtimeChannel.unsubscribe();
        realtimeChannel = null;
      }

      modalSettings.classList.remove("show");
      showToast("Supabase desconectado. Ejecutando en local.", "info");
      loadFromLocalStorage();
    });
  }

  // 4. Slider de historial de partidas
  const slider = document.getElementById("chart-history-slider");
  if (slider) {
    slider.addEventListener("input", (e) => {
      window.userChartOffset = parseInt(e.target.value);
      drawLineChart();
    });
  }

  // 5. Botón RESET (En el footer) -> Limpia marcadores a 0 y borra historial de la gráfica
  const btnResetTrigger = document.getElementById("btn-reset-all");
  if (btnResetTrigger) {
    btnResetTrigger.addEventListener("click", async () => {
      if (confirm("¿Reiniciar TODOS los marcadores y limpiar el historial de la gráfica por completo?")) {
        playersData.forEach(p => {
          if (!p || !p.stats) return;
          const stats = p.stats;
          stats.moris = 0;
          stats.dcs = 0;
          stats.escapes = 0;
          stats.firstDeaths = 0;
          stats.bloodpoints = 0;
          stats.history = [0];
        });

        activeMatchCommitted = false; 
        window.userChartOffset = 0; // Reiniciar slider offset
        renderCounters(); 

        if (supabaseClient) {
          try {
            const ids = playersData.map(p => p.id);
            await supabaseClient
              .from("players")
              .update({
                moris: 0,
                dcs: 0,
                escapes: 0,
                first_deaths: 0,
                bloodpoints: 0,
                history: "[0]"
              })
              .in("id", ids);
            showToast("Calculadora y Gráfica reiniciadas a cero.", "info");
          } catch (err) {
            console.error(err);
          }
        } else {
          saveData();
          showToast("Calculadora local restablecida.", "info");
        }
      }
    });
  }

  // 6. Botón FINAL (Registra partida, calcula puntos y los agrega a la gráfica siempre)
  const btnFinalTrigger = document.getElementById("btn-final-all");
  if (btnFinalTrigger) {
    btnFinalTrigger.addEventListener("click", async () => {
      // 1. Calcular y agregar un nuevo registro al historial de la gráfica
      playersData.forEach(p => {
        if (!p || !p.stats) return;
        const stats = p.stats;
        
        // Puntaje acumulativo calculado a partir de los datos acumulados
        const currentMatchScore = (stats.escapes * 5) - (stats.moris * 2) - (stats.firstDeaths * 5) + (stats.bloodpoints * 8) + (stats.dcs * 11);
        
        // Siempre hacemos push de la puntuación calculada
        stats.history.push(currentMatchScore);
      });

      activeMatchCommitted = true;
      
      // Auto-desplazar slider de historial al final para ver el nuevo punto de partida
      const maxL = Math.max(...playersData.map(p => p ? p.stats.history.length : 1), 1);
      const windowSize = window.innerWidth < 820 ? 8 : 20;
      window.userChartOffset = Math.max(0, maxL - windowSize);

      renderCounters(); // Redibujar contadores y actualizar gráfica y sidebar

      // 2. Subir el historial de la gráfica a Supabase o Local
      if (supabaseClient) {
        try {
          for (let i = 0; i < 4; i++) {
            const p = playersData[i];
            await supabaseClient
              .from("players")
              .update({ history: JSON.stringify(p.stats.history) })
              .eq("id", p.id);
          }
          showToast("¡Punto agregado a la gráfica correctamente!", "success");
        } catch (err) {
          console.error(err);
        }
      } else {
        saveData();
        showToast("Partida registrada en local.", "success");
      }
    });
  }
}

// --- CÁLCULO DINÁMICO DE GANADORES Y TÍTULOS ---
function calculateFinalRecap() {
  const recapContainer = document.getElementById("recap-list-container");
  if (!recapContainer) return;

  recapContainer.innerHTML = "";

  const categories = [
    {
      key: "totalScore",
      title: "👑 EL CAMPEÓN DE LA SESIÓN",
      desc: "El sobreviviente definitivo. Dominó la tabla con el mayor puntaje de rango total.",
      suffix: "PTS RANGO"
    },
    {
      key: "escapes",
      title: "🏆 EL MVP",
      desc: "El que sabe para que sirven las puertas de salida, sacando la cara por el equipo.",
      suffix: "ESCAPE"
    },
    {
      key: "bloodpoints",
      title: "💰 EL BANQUERO DE LA ENTIDAD",
      desc: "El que se fue con los bolsillos llenos de puntos de sangre. Aportando al máximo.",
      suffix: "BLOODPOINTS"
    },
    {
      key: "dcs",
      title: "🔌 EL ROMPE-TOBILLOS DE KILLERS",
      desc: "El terror del Asesino. Lo hizo halar el cable.",
      suffix: "KILLER DC"
    },
    {
      key: "moris",
      title: "💀 EL CATADOR DE MORIS",
      desc: "El cliente premium de los asesinatos personalizados. Siempre listo para salir en su foto de recuerdo.",
      suffix: "MEMENTO MORI"
    },
    {
      key: "firstDeaths",
      title: "📦 EL BULTO",
      desc: "El saco de boxeo oficial. Corre a los brazos del killer a la primera.",
      suffix: "FIRST DEATH"
    }
  ];

  function getLeadersFor(statName) {
    let maxVal = statName === "totalScore" ? -Infinity : -1;
    let leaders = [];

    playersData.forEach(player => {
      let val;
      if (statName === "totalScore") {
        const history = player.stats.history || [0];
        val = history[history.length - 1] || 0;
      } else {
        val = player.stats[statName] || 0;
      }

      if (val > maxVal) {
        maxVal = val;
        leaders = [player];
      } else if (val === maxVal) {
        leaders.push(player);
      }
    });

    return { maxVal, leaders };
  }

  function getAvatarFor(name) {
    if (name === "VITIGO") return "char_vitigo.png";
    if (name === "VINZENT") return "char_vinzent.png";
    if (name === "JOSEDVA") return "char_jose.png";
    if (name === "MIANCOR") return "char_miancor.png";
    return "logo.png";
  }

  categories.forEach(cat => {
    const result = getLeadersFor(cat.key);
    let winnerName = "NADIE";
    let scoreText = "0";
    let avatarsHtml = "";

    const hasWinner = cat.key === "totalScore" ? true : result.maxVal > 0;

    if (hasWinner) {
      winnerName = result.leaders.map(l => l.name).join(" & ");
      scoreText = (cat.key === "totalScore" && result.maxVal > 0 ? "+" : "") + result.maxVal;

      result.leaders.forEach(leader => {
        const avatarSrc = getAvatarFor(leader.name);
        avatarsHtml += `
          <div class="recap-winner-avatar">
            <img src="${avatarSrc}" alt="${leader.name}">
          </div>
        `;
      });
    } else {
      avatarsHtml = `
        <div class="recap-winner-avatar">
          <img src="logo.png" alt="Nadie">
        </div>
      `;
      winnerName = "NADIE";
      scoreText = "0";
    }

    const itemHtml = `
      <div class="recap-item">
        <div class="recap-item-header">
          <span class="recap-funny-title">${cat.title}</span>
          <div class="recap-winner-name">${winnerName}</div>
          <div class="recap-winner-avatars-box">
            ${avatarsHtml}
          </div>
        </div>
        <div class="recap-bottom-row">
          <p class="recap-funny-desc">${cat.desc}</p>
          <div class="recap-score-badge">
            <span class="recap-score-val">${scoreText}</span>
            <span class="recap-score-label">${cat.suffix}</span>
          </div>
        </div>
      </div>
    `;
    recapContainer.appendChild(document.createRange().createContextualFragment(itemHtml));
  });
}

// --- RENDERIZAR VALORES DE CONTADORES CON ICONOS REPETIDOS ---
function renderCounters() {
  try {
    const statsList = ["moris", "dcs", "escapes", "firstDeaths", "bloodpoints"];

    // 1. Alinear y sincronizar longitud temporal de historiales
    const maxL = Math.max(...playersData.map(p => p ? p.stats.history.length : 1), 1);
    playersData.forEach(p => {
      if (!p || !p.stats || !p.stats.history) return;
      while (p.stats.history.length < maxL) {
        p.stats.history.push(p.stats.history[p.stats.history.length - 1] || 0);
      }
    });

    saveData();

    // 2. Renderizar iconos repetidos en la interfaz
    for (let i = 0; i < 4; i++) {
      if (playersData[i] && playersData[i].stats) {
        const stats = playersData[i].stats;
        
        statsList.forEach(stat => {
          const container = document.getElementById(`val-${i}-${stat}`);
          if (!container) return;

          container.innerHTML = "";
          const count = stats[stat] || 0;
          
          for (let c = 0; c < count; c++) {
            const img = document.createElement("img");
            
            if (stat === "moris") img.src = "mori.png";
            else if (stat === "dcs") img.src = "dc.png";
            else if (stat === "escapes") img.src = "escape.png";
            else if (stat === "firstDeaths") img.src = "first_death.png";
            else if (stat === "bloodpoints") img.src = "bloodpoints.png";
            
            img.alt = stat;
            img.className = "mini-icon-img";
            img.title = "Haz clic aquí para eliminar este icono";
            
            img.addEventListener("click", () => {
              if (playersData[i].stats[stat] > 0) {
                playersData[i].stats[stat]--;
                renderCounters();
                playAudioFor(stat);
                
                updatePlayerStat(i, stat, playersData[i].stats[stat]);
              }
            });

            container.appendChild(img);
          }
        });
      }
    }

    // 3. Recalcular y actualizar la columna de ganadores permanente de la derecha
    calculateFinalRecap();

  } catch (err) {
    console.error("Error rendering counters:", err);
  }

  // 4. Dibujar la gráfica de líneas estilo Mario Party
  drawLineChart();
}

// --- DIBUJAR GRÁFICA DE LÍNEAS TEMPORAL (ESTILO MARIO PARTY) ---
function drawLineChart() {
  try {
    const container = document.getElementById("line-chart-container");
    if (!container) return;

    // Ventana ajustable: 20 en PC, 8 en móviles
    const windowSize = window.innerWidth < 820 ? 8 : 20;
    const maxL = Math.max(...playersData.map(p => p ? p.stats.history.length : 1), 1);
    
    // Configurar el slider de historial
    const slider = document.getElementById("chart-history-slider");
    const sliderValLabel = document.getElementById("chart-slider-value");
    
    let startIndex = Math.max(0, maxL - windowSize);
    const maxOffset = Math.max(0, maxL - windowSize);

    if (slider) {
      slider.max = maxOffset;
      if (maxOffset === 0) {
        slider.disabled = true;
        slider.value = 0;
        startIndex = 0;
      } else {
        slider.disabled = false;
        // Si el usuario no ha arrastrado manualmente o si supera el límite, mover al final
        if (typeof window.userChartOffset === "undefined" || window.userChartOffset > maxOffset) {
          window.userChartOffset = maxOffset;
        }
        slider.value = window.userChartOffset;
        startIndex = window.userChartOffset;
      }

      if (sliderValLabel) {
        const endIdx = Math.min(startIndex + windowSize - 1, maxL - 1);
        sliderValLabel.textContent = `Partidas ${startIndex} - ${endIdx}`;
      }
    }

    const currentWindowLength = Math.min(windowSize, maxL - startIndex);

    // Encontrar rango de puntuaciones visibles en la ventana deslizante
    let visibleScores = [];
    playersData.forEach(p => {
      if (!p || !p.stats || !p.stats.history) return;
      const scores = p.stats.history.slice(startIndex, startIndex + windowSize);
      visibleScores = visibleScores.concat(scores);
    });

    const minY = Math.min(...visibleScores, 0); 
    const maxY = Math.max(...visibleScores, 5); 

    const yPadding = Math.max(5, (maxY - minY) * 0.15);
    const yMinLimit = minY - yPadding;
    const yMaxLimit = maxY + yPadding;

    const svgWidth = container.clientWidth && container.clientWidth > 0 ? container.clientWidth : 400;
    const svgHeight = container.clientHeight && container.clientHeight > 0 ? container.clientHeight : 300;

    const paddingLeft = 32;
    const paddingRight = 45; 
    const paddingTop = 25;
    const paddingBottom = 30;

    const graphWidth = svgWidth - paddingLeft - paddingRight;
    const graphHeight = svgHeight - paddingTop - paddingBottom;

    // 1. Obtener o Crear el SVG
    let svg = container.querySelector("svg");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", svgWidth);
      svg.setAttribute("height", svgHeight);
      svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
      svg.setAttribute("style", "overflow: visible;");
      container.appendChild(svg);
    } else {
      svg.setAttribute("width", svgWidth);
      svg.setAttribute("height", svgHeight);
      svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
    }

    // 2. Obtener o Crear Estructuras de Grupos
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.appendChild(defs);
    }

    let gridGroup = svg.querySelector(".grid-lines-group");
    if (!gridGroup) {
      gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      gridGroup.setAttribute("class", "grid-lines-group");
      svg.appendChild(gridGroup);
    }

    let yLabelsGroup = svg.querySelector(".y-labels-group");
    if (!yLabelsGroup) {
      yLabelsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      yLabelsGroup.setAttribute("class", "y-labels-group");
      svg.appendChild(yLabelsGroup);
    }

    let xLabelsGroup = svg.querySelector(".x-labels-group");
    if (!xLabelsGroup) {
      xLabelsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      xLabelsGroup.setAttribute("class", "x-labels-group");
      svg.appendChild(xLabelsGroup);
    }

    // Asegurar Ejes Principales (Dirección Plana sin Grupos Intermedios)
    let xAxis = svg.querySelector("#chart-x-axis");
    if (!xAxis) {
      xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
      xAxis.setAttribute("id", "chart-x-axis");
      xAxis.setAttribute("class", "chart-axis-line");
      svg.appendChild(xAxis);
    }
    xAxis.setAttribute("x1", paddingLeft);
    xAxis.setAttribute("y1", paddingTop + graphHeight);
    xAxis.setAttribute("x2", paddingLeft + graphWidth);
    xAxis.setAttribute("y2", paddingTop + graphHeight);

    let yAxis = svg.querySelector("#chart-y-axis");
    if (!yAxis) {
      yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
      yAxis.setAttribute("id", "chart-y-axis");
      yAxis.setAttribute("class", "chart-axis-line");
      svg.appendChild(yAxis);
    }
    yAxis.setAttribute("x1", paddingLeft);
    yAxis.setAttribute("y1", paddingTop);
    yAxis.setAttribute("x2", paddingLeft);
    yAxis.setAttribute("y2", paddingTop + graphHeight);

    // --- 3. DIBUJAR LÍNEAS DE CUADRÍCULA VERTICALES (DESLIZABLES) ---
    gridGroup.innerHTML = "";
    xLabelsGroup.innerHTML = "";

    const gridCols = Math.max(5, currentWindowLength);
    for (let i = 0; i < gridCols; i++) {
      const x = paddingLeft + (i / (gridCols - 1)) * graphWidth;
      
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x);
      line.setAttribute("y1", paddingTop);
      line.setAttribute("x2", x);
      line.setAttribute("y2", paddingTop + graphHeight);
      line.setAttribute("class", "chart-grid-line");
      gridGroup.appendChild(line);

      if (i < currentWindowLength) {
        const matchIdx = startIndex + i;
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", x);
        label.setAttribute("y", paddingTop + graphHeight + 18);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "chart-axis-text");
        label.textContent = `P${matchIdx}`;
        xLabelsGroup.appendChild(label);
      }
    }

    // --- 4. DIBUJAR LÍNEAS DE CUADRÍCULA HORIZONTALES (PUNTOS) ---
    yLabelsGroup.innerHTML = "";
    const gridRows = 5;
    for (let i = 0; i < gridRows; i++) {
      const ratio = i / (gridRows - 1);
      const y = paddingTop + ratio * graphHeight;
      const scoreVal = Math.round(yMaxLimit - ratio * (yMaxLimit - yMinLimit));

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", paddingLeft);
      line.setAttribute("y1", y);
      line.setAttribute("x2", paddingLeft + graphWidth);
      line.setAttribute("y2", y);
      line.setAttribute("class", "chart-grid-line");
      gridGroup.appendChild(line);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", paddingLeft - 8);
      label.setAttribute("y", y + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "chart-axis-text-y");
      label.textContent = scoreVal;
      yLabelsGroup.appendChild(label);
    }

    // --- 5. TRAZOS Y AVATARES DE CADA JUGADOR (PERSISTENTES Y ANIMADOS) ---
    const playerConfigs = [
      { class: "vitigo", avatar: "char_vitigo.png" },
      { class: "vinzent", avatar: "char_vinzent.png" },
      { class: "jose", avatar: "char_jose.png" },
      { class: "miancor", avatar: "char_miancor.png" }
    ];

    // Calcular las posiciones finales del extremo de la ventana
    const finalPositions = playersData.map((p, idx) => {
      if (!p || !p.stats || !p.stats.history) return { idx, finalScore: 0, x: paddingLeft, y: paddingTop + graphHeight };
      const scores = p.stats.history.slice(startIndex, startIndex + windowSize);
      const finalScore = scores[scores.length - 1] || 0;
      
      const x = paddingLeft + ((scores.length - 1) / (gridCols - 1)) * graphWidth;
      const y = paddingTop + graphHeight - ((finalScore - yMinLimit) / (yMaxLimit - yMinLimit)) * graphHeight;

      return { idx, finalScore, x, y };
    });

    // Dispersión vertical anti-solapamiento optimizada a 30px (evita colisiones de avatares de 28px)
    finalPositions.sort((a, b) => a.y - b.y);
    for (let i = 1; i < finalPositions.length; i++) {
      const prev = finalPositions[i - 1];
      const curr = finalPositions[i];
      if (Math.abs(curr.y - prev.y) < 30) {
        curr.y = prev.y + 30;
      }
    }

    playersData.forEach((p, idx) => {
      if (!p || !p.stats || !p.stats.history) return;
      const config = playerConfigs[idx];
      const scores = p.stats.history.slice(startIndex, startIndex + windowSize);

      // Path
      let path = svg.querySelector(`#chart-path-${config.class}`);
      if (!path) {
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("id", `chart-path-${config.class}`);
        path.setAttribute("class", `chart-line-${config.class}`);
        svg.appendChild(path);
      }

      // Grupo de Círculos
      let circlesGroup = svg.querySelector(`#chart-circles-group-${config.class}`);
      if (!circlesGroup) {
        circlesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        circlesGroup.setAttribute("id", `chart-circles-group-${config.class}`);
        svg.appendChild(circlesGroup);
      }

      // Defs clipPath
      let clipPath = defs.querySelector(`#clip-avatar-${idx}`);
      let clipCircle;
      if (!clipPath) {
        clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
        clipPath.setAttribute("id", `clip-avatar-${idx}`);
        clipCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        clipCircle.setAttribute("id", `clip-circle-${idx}`);
        clipCircle.setAttribute("r", "14");
        clipPath.appendChild(clipCircle);
        defs.appendChild(clipPath);
      } else {
        clipCircle = clipPath.querySelector("circle");
        if (!clipCircle) {
          clipCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          clipCircle.setAttribute("id", `clip-circle-${idx}`);
          clipCircle.setAttribute("r", "14");
          clipPath.appendChild(clipCircle);
        }
      }

      // Elementos de imagen
      let img = svg.querySelector(`#chart-avatar-img-${config.class}`);
      if (!img) {
        img = document.createElementNS("http://www.w3.org/2000/svg", "image");
        img.setAttribute("id", `chart-avatar-img-${config.class}`);
        img.setAttribute("href", config.avatar);
        img.setAttribute("clip-path", `url(#clip-avatar-${idx})`);
        svg.appendChild(img);
      }

      // Borde
      let borderCircle = svg.querySelector(`#chart-avatar-border-${config.class}`);
      if (!borderCircle) {
        borderCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        borderCircle.setAttribute("id", `chart-avatar-border-${config.class}`);
        borderCircle.setAttribute("class", `chart-avatar-border chart-avatar-border-${config.class}`);
        svg.appendChild(borderCircle);
      }

      // Calcular puntos de ventana
      let pathD = "";
      const currentPoints = [];

      scores.forEach((score, mIdx) => {
        const x = paddingLeft + (mIdx / (gridCols - 1)) * graphWidth;
        const y = paddingTop + graphHeight - ((score - yMinLimit) / (yMaxLimit - yMinLimit)) * graphHeight;

        if (mIdx === 0) pathD += `M ${x} ${y}`;
        else pathD += ` L ${x} ${y}`;

        currentPoints.push({ x, y, score, matchIdx: startIndex + mIdx });
      });

      // Actualizar Path
      path.setAttribute("d", pathD);

      // Ajustar número de círculos visibles
      const existingCircles = circlesGroup.querySelectorAll("circle");
      const diff = currentPoints.length - existingCircles.length;

      if (diff > 0) {
        for (let k = 0; k < diff; k++) {
          const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("class", `chart-point chart-point-${config.class}`);
          c.setAttribute("r", "4");
          circlesGroup.appendChild(c);
        }
      } else if (diff < 0) {
        for (let k = 0; k < Math.abs(diff); k++) {
          existingCircles[existingCircles.length - 1 - k].remove();
        }
      }

      // Actualizar coordenadas de círculos
      const updatedCircles = circlesGroup.querySelectorAll("circle");
      currentPoints.forEach((pt, mIdx) => {
        const c = updatedCircles[mIdx];
        if (c) {
          c.setAttribute("cx", pt.x);
          c.setAttribute("cy", pt.y);
          c.setAttribute("title", `${p.name}: ${pt.score} pts (Partida ${pt.matchIdx})`);
        }
      });

      // Actualizar coordenadas de Avatares (Imagen, Clip y Borde)
      const finalPos = finalPositions.find(fp => fp.idx === idx);
      if (finalPos) {
        const avatarSize = 28;
        const imgX = finalPos.x + 8;
        const imgY = finalPos.y - avatarSize / 2;

        clipCircle.setAttribute("cx", imgX + avatarSize / 2);
        clipCircle.setAttribute("cy", imgY + avatarSize / 2);
        clipCircle.setAttribute("r", avatarSize / 2);

        img.setAttribute("x", imgX);
        img.setAttribute("y", imgY);
        img.setAttribute("width", avatarSize);
        img.setAttribute("height", avatarSize);

        borderCircle.setAttribute("cx", imgX + avatarSize / 2);
        borderCircle.setAttribute("cy", imgY + avatarSize / 2);
        borderCircle.setAttribute("r", avatarSize / 2);
      }
    });
  } catch (err) {
    console.error("Error drawing line chart:", err);
  }
}

// --- MOSTRAR TOAST ---
function showToast(message, type = "info") {
  const toast = document.getElementById("toast-notify");
  const text = document.getElementById("toast-text");
  if (!toast || !text) return;

  text.textContent = message;
  toast.className = "toast-notification show " + type;

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}
