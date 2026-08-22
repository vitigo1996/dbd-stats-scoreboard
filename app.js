/**
 * DEAD BY STATS - SCOREBOARD HUD CALCULATOR LOGIC
 */

// --- VARIABLES DE ESTADO ---
let playersData = [];
let supabaseClient = null;
let realtimeChannel = null;

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
  // Si el usuario desconectó explícitamente la base de datos, ir a modo local offline
  if (localStorage.getItem("dbd_supabase_disabled") === "true") {
    supabaseClient = null;
    return false;
  }

  // Intentar obtener valores personalizados de LocalStorage, si no usar los valores por defecto
  const url = localStorage.getItem("dbd_supabase_url") || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem("dbd_supabase_key") || DEFAULT_SUPABASE_KEY;

  if (url && key) {
    try {
      // Instanciar cliente desde la librería cargada por CDN (global 'supabase')
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
      // Intentar consultar la tabla de jugadores
      const { data, error } = await supabaseClient
        .from("players")
        .select("*")
        .order("id", { ascending: true });

      if (error) throw error;

      if (data && data.length === 4) {
        playersData = data.map(row => ({
          name: row.name,
          stats: {
            moris: row.moris || 0,
            dcs: row.dcs || 0,
            escapes: row.escapes || 0,
            firstDeaths: row.first_deaths || 0,
            bloodpoints: row.bloodpoints || 0
          }
        }));
        renderCounters();
        subscribeRealtime();
        showToast("Conectado a Supabase en tiempo real.", "success");
        return; // Carga exitosa desde Supabase
      } else {
        console.warn("Supabase no contiene exactamente 4 jugadores. Intentando inicializar tabla...");
        // Intentar inicializar tabla vacía
        await pushAllDataToSupabase();
        // Si no hay datos, continuamos para cargar local como fallback
      }
    } catch (err) {
      console.error("Error al conectar con Supabase. Usando LocalStorage offline.", err);
      showToast("Error de conexión con Supabase. Usando LocalStorage offline.", "info");
    }
  }

  // Fallback a LocalStorage si Supabase falla o no está configurado
  loadFromLocalStorage();
}

function loadFromLocalStorage() {
  const savedData = localStorage.getItem("dbd_calculator_data");
  if (savedData) {
    try {
      playersData = JSON.parse(savedData);
      
      // Sanitizar datos y validar nombres fijos del grupo
      playersData.forEach((player, idx) => {
        const defaultNames = ["VITIGO", "VINZENT", "JOSEDVA", "MIANCOR"];
        player.name = defaultNames[idx]; // Forzar nombres estáticos

        if (!player.stats) {
          player.stats = { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 };
        } else {
          delete player.stats.matches;
          if (player.stats.moris === undefined) player.stats.moris = 0;
          if (player.stats.dcs === undefined) player.stats.dcs = 0;
          if (player.stats.escapes === undefined) player.stats.escapes = 0;
          if (player.stats.firstDeaths === undefined) player.stats.firstDeaths = 0;
          if (player.stats.bloodpoints === undefined) player.stats.bloodpoints = 0;
        }
      });
      saveData();
    } catch (e) {
      initializeDefaultData();
    }
  } else {
    initializeDefaultData();
  }
  renderCounters();
}

function initializeDefaultData() {
  playersData = [
    { name: "VITIGO", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 } },
    { name: "VINZENT", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 } },
    { name: "JOSEDVA", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 } },
    { name: "MIANCOR", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 } }
  ];
  saveData();
}

function saveData() {
  localStorage.setItem("dbd_calculator_data", JSON.stringify(playersData));
}

// --- ACTUALIZAR REGISTROS DE JUGADORES A SUPABASE ---
async function pushAllDataToSupabase() {
  if (!supabaseClient) return;
  try {
    for (let i = 0; i < 4; i++) {
      const p = playersData[i] || { name: "", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0 } };
      await supabaseClient.from("players").upsert({
        id: i,
        name: p.name,
        moris: p.stats.moris,
        dcs: p.stats.dcs,
        escapes: p.stats.escapes,
        first_deaths: p.stats.firstDeaths,
        bloodpoints: p.stats.bloodpoints
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
        const idx = updatedRow.id;
        if (playersData[idx]) {
          playersData[idx].stats = {
            moris: updatedRow.moris || 0,
            dcs: updatedRow.dcs || 0,
            escapes: updatedRow.escapes || 0,
            firstDeaths: updatedRow.first_deaths || 0,
            bloodpoints: updatedRow.bloodpoints || 0
          };
          renderCounters();
        }
      }
    )
    .subscribe();
}

// --- ENVIAR ACTUALIZACIÓN DE CONTADORES A BASE DE DATOS ---
async function updatePlayerStat(playerIdx, statName, value) {
  if (supabaseClient) {
    const dbColName = statName === "firstDeaths" ? "first_deaths" : statName;
    try {
      const { error } = await supabaseClient
        .from("players")
        .update({ [dbColName]: value })
        .eq("id", playerIdx);
      
      if (error) throw error;
    } catch (err) {
      console.error("Error actualizando Supabase en vivo:", err);
    }
  } else {
    // Modo local offline
    saveData();
  }
}

// --- AMBIENTE DE LA HOGUERA (BRASAS FLOTANTES) ---
function initAtmosphere() {
  // Desactivar animaciones de partículas pesadas en móviles para optimizar rendimiento
  if (window.innerWidth < 820) {
    console.log("Rendimiento: Atmósfera desactivada en móviles.");
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

// --- SISTEMA DE AUDIO DEL JUEGO (REPRODUCCIÓN DE MP3 LOCALES SI EXISTEN) ---
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
      audio.play().catch(() => {
        // Falla silenciosa si el archivo no existe
      });
    }
  } catch (err) {
    // Evitar errores de consola
  }
}

// --- ANIMACIÓN FLOTANTE (VUELO DESDE EL CENTRO HACIA LA FILA CORRESPONDIENTE) ---
function triggerFlyAnimation(imgSrc, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 1. Obtener las coordenadas del contenedor destino
  const rect = container.getBoundingClientRect();
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.top + rect.height / 2;

  // 2. Crear clon flotante temporal
  const flyIcon = document.createElement("img");
  flyIcon.src = imgSrc;
  flyIcon.className = "floating-fly-icon";
  flyIcon.style.setProperty("--target-x", `${targetX}px`);
  flyIcon.style.setProperty("--target-y", `${targetY}px`);

  document.body.appendChild(flyIcon);

  // 3. Eliminar el clon temporal cuando termine el vuelo (1250ms)
  setTimeout(() => {
    flyIcon.remove();
  }, 1250);
}

// --- CONFIGURACIÓN DE LA CALCULADORA Y SCOREBOARD ---
function initCalculator() {
  // 1. Click sobre el icono de referencia para Sumar (Clic Izquierdo) o Restar (Clic Derecho)
  const iconButtons = document.querySelectorAll(".btn-icon-calc");
  iconButtons.forEach(btn => {
    // Clic Izquierdo -> Sumar 1 (con animación de vuelo)
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const playerIdx = parseInt(btn.getAttribute("data-player"));
      const statName = btn.getAttribute("data-stat");

      if (playersData[playerIdx] && playersData[playerIdx].stats) {
        // Disparar animación de vuelo desde el centro de la pantalla
        const imgSrc = btn.querySelector("img").getAttribute("src");
        const containerId = `val-${playerIdx}-${statName}`;
        triggerFlyAnimation(imgSrc, containerId);

        // Sumar local (actualización optimista instantánea)
        playersData[playerIdx].stats[statName]++;
        renderCounters();
        playAudioFor(statName); // Reproducir audio local
        
        // Sincronizar en la nube o LocalStorage
        updatePlayerStat(playerIdx, statName, playersData[playerIdx].stats[statName]);
      }
    });

    // Clic Derecho -> Restar 1
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault(); // Evitar menú de click derecho nativo
      const playerIdx = parseInt(btn.getAttribute("data-player"));
      const statName = btn.getAttribute("data-stat");

      if (playersData[playerIdx] && playersData[playerIdx].stats) {
        if (playersData[playerIdx].stats[statName] > 0) {
          // Restar local (optimista)
          playersData[playerIdx].stats[statName]--;
          renderCounters();
          playAudioFor(statName);

          // Sincronizar
          updatePlayerStat(playerIdx, statName, playersData[playerIdx].stats[statName]);
        }
      }
    });
  });

  // 2. Control de popup modal de confirmación de Reset
  const modalReset = document.getElementById("reset-confirm-modal");
  const btnCancelReset = document.getElementById("btn-modal-cancel");
  const btnConfirmReset = document.getElementById("btn-modal-confirm");
  const btnResetTrigger = document.getElementById("btn-reset-all");

  if (btnResetTrigger && modalReset) {
    btnResetTrigger.addEventListener("click", () => {
      modalReset.classList.add("show");
    });
  }

  if (btnCancelReset) {
    btnCancelReset.addEventListener("click", () => {
      modalReset.classList.remove("show");
    });
  }

  if (btnConfirmReset) {
    btnConfirmReset.addEventListener("click", async () => {
      // Reinicio local inmediato
      playersData.forEach(player => {
        for (let stat in player.stats) {
          player.stats[stat] = 0;
        }
      });
      renderCounters();
      modalReset.classList.remove("show");

      // Sincronizar reinicio
      if (supabaseClient) {
        try {
          // Actualización de múltiples filas en Supabase
          const { error } = await supabaseClient
            .from("players")
            .update({ moris: 0, dcs: 0, escapes: 0, first_deaths: 0, bloodpoints: 0 })
            .in("id", [0, 1, 2, 3]);
          if (error) throw error;
        } catch (err) {
          console.error("Error al reiniciar datos en Supabase:", err);
        }
      } else {
        saveData();
      }
    });
  }

  // 3. Control de popup modal de Recuento Final
  const modalRecap = document.getElementById("final-recap-modal");
  const btnFinalTrigger = document.getElementById("btn-final-all");
  const btnCloseRecap = document.getElementById("btn-recap-close");

  if (btnFinalTrigger && modalRecap) {
    btnFinalTrigger.addEventListener("click", () => {
      calculateFinalRecap();
      modalRecap.classList.add("show");
    });
  }

  if (btnCloseRecap && modalRecap) {
    btnCloseRecap.addEventListener("click", () => {
      modalRecap.classList.remove("show");
    });
  }

  // 4. Control de popup modal de Ajustes (Supabase)
  const modalSettings = document.getElementById("settings-modal");
  const btnSettingsTrigger = document.getElementById("btn-settings");
  const btnCloseSettings = document.getElementById("btn-settings-close");
  const btnSaveSettings = document.getElementById("btn-settings-save");
  const btnDisconnectSettings = document.getElementById("btn-settings-disconnect");

  const urlInput = document.getElementById("supabase-url-input");
  const keyInput = document.getElementById("supabase-key-input");

  if (btnSettingsTrigger && modalSettings) {
    btnSettingsTrigger.addEventListener("click", () => {
      // Cargar valores actuales de LocalStorage o los valores por defecto
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
      loadData(); // Intentar reconectar
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
      loadFromLocalStorage(); // Volver al LocalStorage local
    });
  }
}

// --- CÁLCULO DINÁMICO DE GANADORES Y TÍTULOS GRACIOSOS ---
function calculateFinalRecap() {
  const recapContainer = document.getElementById("recap-list-container");
  if (!recapContainer) return;

  recapContainer.innerHTML = "";

  const categories = [
    {
      key: "escapes",
      title: "🏆 EL MVP",
      desc: "El que sabe para que sirven las puertas de salida, sacando la cara por el equipo.",
      suffix: "ESCAPE"
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
    },
    {
      key: "bloodpoints",
      title: "💰 EL BANQUERO DE LA ENTIDAD",
      desc: "El que se fue con los bolsillos llenos de puntos de sangre. Aportando al máximo.",
      suffix: "BLOODPOINTS"
    }
  ];

  // Helper para buscar líderes de una estadística
  function getLeadersFor(statName) {
    let maxVal = -1;
    let leaders = [];

    playersData.forEach(player => {
      const val = player.stats[statName] || 0;
      if (val > maxVal) {
        maxVal = val;
        leaders = [player];
      } else if (val === maxVal) {
        leaders.push(player);
      }
    });

    return { maxVal, leaders };
  }

  // Helper para mapear avatares
  function getAvatarFor(name) {
    if (name === "VITIGO") return "char_vitigo.png";
    if (name === "VINZENT") return "char_vinzent.png";
    if (name === "JOSEDVA") return "char_jose.png";
    if (name === "MIANCOR") return "char_miancor.png";
    return "logo.png";
  }

  // Renderizar cada categoría en mosaico
  categories.forEach(cat => {
    const result = getLeadersFor(cat.key);
    let winnerName = "NADIE";
    let scoreText = "0";
    let avatarsHtml = "";

    // Si el valor máximo es mayor a cero, renderizar ganadores (con soporte de empates)
    if (result.maxVal > 0) {
      winnerName = result.leaders.map(l => l.name).join(" & ");
      scoreText = result.maxVal;

      result.leaders.forEach(leader => {
        const avatarSrc = getAvatarFor(leader.name);
        avatarsHtml += `
          <div class="recap-winner-avatar">
            <img src="${avatarSrc}" alt="${leader.name}">
          </div>
        `;
      });
    } else {
      // Caso nadie tiene puntos en esta categoría
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
        <div>
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
  const statsList = ["moris", "dcs", "escapes", "firstDeaths", "bloodpoints"];

  for (let i = 0; i < 4; i++) {
    if (playersData[i] && playersData[i].stats) {
      const stats = playersData[i].stats;
      
      statsList.forEach(stat => {
        const container = document.getElementById(`val-${i}-${stat}`);
        if (!container) return;

        container.innerHTML = "";

        const count = stats[stat] || 0;
        
        // Agregar iconos repetidos
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
          
          // Evento de clic en mini-icono para restar 1
          img.addEventListener("click", () => {
            if (playersData[i].stats[stat] > 0) {
              // Restar local optimista
              playersData[i].stats[stat]--;
              renderCounters();
              playAudioFor(stat); // Reproducir audio local
              
              // Sincronizar
              updatePlayerStat(i, stat, playersData[i].stats[stat]);
            }
          });

          container.appendChild(img);
        }
      });
    }
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
