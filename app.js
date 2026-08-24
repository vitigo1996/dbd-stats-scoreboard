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
            bloodpoints: row.bloodpoints || 0,
            history: row.history ? JSON.parse(row.history) : [0]
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
          player.stats = { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] };
        } else {
          delete player.stats.matches;
          if (player.stats.moris === undefined) player.stats.moris = 0;
          if (player.stats.dcs === undefined) player.stats.dcs = 0;
          if (player.stats.escapes === undefined) player.stats.escapes = 0;
          if (player.stats.firstDeaths === undefined) player.stats.firstDeaths = 0;
          if (player.stats.bloodpoints === undefined) player.stats.bloodpoints = 0;
          if (!player.stats.history || !Array.isArray(player.stats.history)) {
            player.stats.history = [0];
          }
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
    { name: "VITIGO", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { name: "VINZENT", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { name: "JOSEDVA", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } },
    { name: "MIANCOR", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } }
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
      const p = playersData[i] || { name: "", stats: { moris: 0, dcs: 0, escapes: 0, firstDeaths: 0, bloodpoints: 0, history: [0] } };
      await supabaseClient.from("players").upsert({
        id: i,
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
        const idx = updatedRow.id;
        if (playersData[idx]) {
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
  if (supabaseClient) {
    const dbColName = statName === "firstDeaths" ? "first_deaths" : statName;
    let dbValue = value;
    if (statName === "history") {
      dbValue = JSON.stringify(value);
    }
    try {
      const { error } = await supabaseClient
        .from("players")
        .update({ [dbColName]: dbValue })
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

  // 2. Botón "REINICIAR TODO" (Vacía contadores y limpia el historial de rango a [0])
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
      // Reinicio local completo
      playersData.forEach(player => {
        player.stats.moris = 0;
        player.stats.dcs = 0;
        player.stats.escapes = 0;
        player.stats.firstDeaths = 0;
        player.stats.bloodpoints = 0;
        player.stats.history = [0]; // Volver a empezar
      });
      
      localStorage.removeItem("dbd_last_match_counters");
      renderCounters();
      modalReset.classList.remove("show");

      // Sincronizar reinicio
      if (supabaseClient) {
        try {
          const { error } = await supabaseClient
            .from("players")
            .update({ moris: 0, dcs: 0, escapes: 0, first_deaths: 0, bloodpoints: 0, history: "[0]" })
            .in("id", [0, 1, 2, 3]);
          if (error) throw error;
        } catch (err) {
          console.error("Error al reiniciar datos en Supabase:", err);
        }
      } else {
        saveData();
      }
      
      updateUndoButtonVisibility();
      showToast("Toda la sesión e historial han sido reiniciados.", "info");
    });
  }

  // 3. Botón "REGISTRAR PARTIDA" (Registra scores en historial y resetea marcadores a 0)
  const btnRecordMatch = document.getElementById("btn-record-match");
  if (btnRecordMatch) {
    btnRecordMatch.addEventListener("click", async () => {
      // 1. Guardar backup para poder deshacer
      const backupCounters = playersData.map(p => ({
        moris: p.stats.moris,
        dcs: p.stats.dcs,
        escapes: p.stats.escapes,
        firstDeaths: p.stats.firstDeaths,
        bloodpoints: p.stats.bloodpoints
      }));
      localStorage.setItem("dbd_last_match_counters", JSON.stringify(backupCounters));

      // 2. Calcular acumulados e incorporar a historiales
      playersData.forEach(p => {
        const currentMatchScore = (p.stats.escapes * 5) - (p.stats.moris * 2) - (p.stats.firstDeaths * 5) + (p.stats.bloodpoints * 8) + (p.stats.dcs * 11);
        const lastCumulativeScore = p.stats.history[p.stats.history.length - 1] || 0;
        const newCumulativeScore = lastCumulativeScore + currentMatchScore;
        
        p.stats.history.push(newCumulativeScore);

        // Limpiar contadores de la partida actual
        p.stats.moris = 0;
        p.stats.dcs = 0;
        p.stats.escapes = 0;
        p.stats.firstDeaths = 0;
        p.stats.bloodpoints = 0;
      });

      renderCounters();

      // 3. Sincronizar en la nube o LocalStorage
      if (supabaseClient) {
        try {
          for (let i = 0; i < 4; i++) {
            const p = playersData[i];
            await supabaseClient
              .from("players")
              .update({
                moris: 0,
                dcs: 0,
                escapes: 0,
                first_deaths: 0,
                bloodpoints: 0,
                history: JSON.stringify(p.stats.history)
              })
              .eq("id", i);
          }
          showToast("Partida registrada e historial actualizado.", "success");
        } catch (err) {
          console.error("Error al registrar partida en Supabase:", err);
          showToast("Registrado localmente (Fallo Supabase).", "info");
        }
      } else {
        saveData();
        showToast("Partida registrada localmente.", "success");
      }

      updateUndoButtonVisibility();
    });
  }

  // 4. Botón "DESHACER" (Quita la última entrada del historial y restaura marcadores anteriores)
  const btnUndoMatch = document.getElementById("btn-undo-match");
  if (btnUndoMatch) {
    btnUndoMatch.addEventListener("click", async () => {
      const backupStr = localStorage.getItem("dbd_last_match_counters");
      if (!backupStr) return;

      if (confirm("¿Deshacer la última partida registrada y recuperar sus marcadores?")) {
        const backup = JSON.parse(backupStr);

        playersData.forEach((p, idx) => {
          // Quitar el último punto del historial
          if (p.stats.history.length > 1) {
            p.stats.history.pop();
          }
          // Restaurar marcadores respaldados
          const bk = backup[idx];
          if (bk) {
            p.stats.moris = bk.moris;
            p.stats.dcs = bk.dcs;
            p.stats.escapes = bk.escapes;
            p.stats.firstDeaths = bk.firstDeaths;
            p.stats.bloodpoints = bk.bloodpoints;
          }
        });

        localStorage.removeItem("dbd_last_match_counters");
        renderCounters();

        // Sincronizar en Supabase o local
        if (supabaseClient) {
          try {
            for (let i = 0; i < 4; i++) {
              const p = playersData[i];
              await supabaseClient
                .from("players")
                .update({
                  moris: p.stats.moris,
                  dcs: p.stats.dcs,
                  escapes: p.stats.escapes,
                  first_deaths: p.stats.firstDeaths,
                  bloodpoints: p.stats.bloodpoints,
                  history: JSON.stringify(p.stats.history)
                })
                .eq("id", i);
            }
            showToast("Último registro deshecho correctamente.", "success");
          } catch (err) {
            console.error("Error al deshacer en Supabase:", err);
          }
        } else {
          saveData();
          showToast("Último registro deshecho localmente.", "success");
        }

        updateUndoButtonVisibility();
      }
    });
  }

  // 5. Control de popup modal de Recuento Final
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

  // 6. Control de popup modal de Ajustes (Supabase)
  const modalSettings = document.getElementById("settings-modal");
  const btnSettingsTrigger = document.getElementById("btn-settings");
  const btnCloseSettings = document.getElementById("btn-settings-close");
  const btnSaveSettings = document.getElementById("btn-settings-save");
  const btnDisconnectSettings = document.getElementById("btn-settings-disconnect");

  const urlInput = document.getElementById("supabase-url-input");
  const keyInput = document.getElementById("supabase-key-input");

  if (btnSettingsTrigger && modalSettings) {
    btnSettingsTrigger.addEventListener("click", () => {
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

// --- VISIBILIDAD DEL BOTÓN DESHACER ---
function updateUndoButtonVisibility() {
  const btnUndoMatch = document.getElementById("btn-undo-match");
  if (!btnUndoMatch) return;
  const backupStr = localStorage.getItem("dbd_last_match_counters");
  // Mostrar solo si hay un backup registrado y tenemos al menos 2 elementos de historial (Match 0 y Match 1)
  if (backupStr && playersData[0]?.stats.history.length > 1) {
    btnUndoMatch.style.display = "block";
  } else {
    btnUndoMatch.style.display = "none";
  }
}

// --- CÁLCULO DINÁMICO DE GANADORES Y TÍTULOS GRACIOSOS ---
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

    const hasWinner = cat.key === "totalScore" ? true : result.maxVal > 0;

    // Si el valor máximo es válido, renderizar ganadores (con soporte de empates)
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

  // Dibujar la gráfica de líneas estilo Mario Party
  drawLineChart();
  updateUndoButtonVisibility();
}

// --- DIBUJAR GRÁFICA DE LÍNEAS TEMPORAL (ESTILO MARIO PARTY) ---
function drawLineChart() {
  const container = document.getElementById("line-chart-container");
  if (!container) return;

  container.innerHTML = "";

  const nMatches = playersData[0]?.stats.history.length || 1;

  // Encontrar rango de puntuaciones de todos los jugadores en todo su historial
  let allScores = [];
  playersData.forEach(p => {
    allScores = allScores.concat(p.stats.history || [0]);
  });

  const minY = Math.min(...allScores, 0); // que siempre incluya el 0 como línea base
  const maxY = Math.max(...allScores, 5); // que al menos llegue a 5 de altura para dar margen inicial

  const yPadding = Math.max(5, (maxY - minY) * 0.15);
  const yMinLimit = minY - yPadding;
  const yMaxLimit = maxY + yPadding;

  const svgWidth = container.clientWidth || 800;
  const svgHeight = 260;

  const paddingLeft = 40;
  const paddingRight = 45; // margen derecho para los avatares
  const paddingTop = 25;
  const paddingBottom = 30;

  const graphWidth = svgWidth - paddingLeft - paddingRight;
  const graphHeight = svgHeight - paddingTop - paddingBottom;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", svgHeight);
  svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute("style", "overflow: visible;");

  // --- 1. DIBUJAR LÍNEAS DE CUADRÍCULA VERTICALES (PARTIDAS) ---
  const gridCols = Math.max(5, nMatches);
  for (let i = 0; i < gridCols; i++) {
    const x = paddingLeft + (i / (gridCols - 1)) * graphWidth;
    
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x);
    line.setAttribute("y1", paddingTop);
    line.setAttribute("x2", x);
    line.setAttribute("y2", paddingTop + graphHeight);
    line.setAttribute("class", "chart-grid-line");
    svg.appendChild(line);

    if (i < nMatches) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", x);
      label.setAttribute("y", paddingTop + graphHeight + 18);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "chart-axis-text");
      label.textContent = `P${i}`;
      svg.appendChild(label);
    }
  }

  // --- 2. DIBUJAR LÍNEAS DE CUADRÍCULA HORIZONTALES (PUNTOS) ---
  const gridRows = 4;
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
    svg.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", paddingLeft - 10);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chart-axis-text-y");
    label.textContent = scoreVal;
    svg.appendChild(label);
  }

  // Ejes principales
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", paddingLeft);
  xAxis.setAttribute("y1", paddingTop + graphHeight);
  xAxis.setAttribute("x2", paddingLeft + graphWidth);
  xAxis.setAttribute("y2", paddingTop + graphHeight);
  xAxis.setAttribute("class", "chart-axis-line");
  svg.appendChild(xAxis);

  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", paddingLeft);
  yAxis.setAttribute("y1", paddingTop);
  yAxis.setAttribute("x2", paddingLeft);
  yAxis.setAttribute("y2", paddingTop + graphHeight);
  yAxis.setAttribute("class", "chart-axis-line");
  svg.appendChild(yAxis);

  // --- 3. DIBUJAR TRAZOS Y AVATARES DE CADA JUGADOR ---
  const playerConfigs = [
    { class: "vitigo", avatar: "char_vitigo.png" },
    { class: "vinzent", avatar: "char_vinzent.png" },
    { class: "jose", avatar: "char_jose.png" },
    { class: "miancor", avatar: "char_miancor.png" }
  ];

  // Dispersión vertical para evitar solapamiento de avatares en puntuaciones idénticas
  const finalPositions = playersData.map((p, idx) => {
    const scores = p.stats.history || [0];
    const finalScore = scores[scores.length - 1] || 0;
    
    const x = paddingLeft + ((scores.length - 1) / (gridCols - 1)) * graphWidth;
    const y = paddingTop + graphHeight - ((finalScore - yMinLimit) / (yMaxLimit - yMinLimit)) * graphHeight;

    return { idx, finalScore, x, y };
  });

  finalPositions.sort((a, b) => a.y - b.y);
  for (let i = 1; i < finalPositions.length; i++) {
    const prev = finalPositions[i - 1];
    const curr = finalPositions[i];
    if (Math.abs(curr.y - prev.y) < 18) {
      curr.y = prev.y + 18; // Desplazar hacia abajo un poco para que no se superpongan
    }
  }

  playersData.forEach((p, idx) => {
    const scores = p.stats.history || [0];
    const config = playerConfigs[idx] || { class: "vitigo", avatar: "logo.png" };

    let pathD = "";
    let pointsData = [];

    scores.forEach((score, mIdx) => {
      const x = paddingLeft + (mIdx / (gridCols - 1)) * graphWidth;
      const y = paddingTop + graphHeight - ((score - yMinLimit) / (yMaxLimit - yMinLimit)) * graphHeight;

      if (mIdx === 0) pathD += `M ${x} ${y}`;
      else pathD += ` L ${x} ${y}`;

      pointsData.push({ x, y, score });
    });

    // Dibujar trazo de línea
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("class", `chart-line-${config.class}`);
    svg.appendChild(path);

    // Dibujar círculos en cada partida
    pointsData.forEach((pt, mIdx) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", pt.x);
      circle.setAttribute("cy", pt.y);
      circle.setAttribute("r", "4");
      circle.setAttribute("class", `chart-point chart-point-${config.class}`);
      circle.setAttribute("title", `${p.name}: ${pt.score} pts (Partida ${mIdx})`);
      svg.appendChild(circle);
    });

    // Colocar avatar al final de la línea
    const finalPos = finalPositions.find(fp => fp.idx === idx);
    if (finalPos) {
      const avatarSize = 28;
      const imgX = finalPos.x + 8;
      const imgY = finalPos.y - avatarSize / 2;

      // Clip circular
      const clipPathId = `clip-avatar-${idx}`;
      const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clipPath.setAttribute("id", clipPathId);
      const clipCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      clipCircle.setAttribute("cx", imgX + avatarSize / 2);
      clipCircle.setAttribute("cy", imgY + avatarSize / 2);
      clipCircle.setAttribute("r", avatarSize / 2);
      clipPath.appendChild(clipCircle);
      svg.appendChild(clipPath);

      // Foto
      const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", config.avatar);
      img.setAttribute("x", imgX);
      img.setAttribute("y", imgY);
      img.setAttribute("width", avatarSize);
      img.setAttribute("height", avatarSize);
      img.setAttribute("clip-path", `url(#${clipPathId})`);
      svg.appendChild(img);

      // Borde circular coloreado
      const borderCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      borderCircle.setAttribute("cx", imgX + avatarSize / 2);
      borderCircle.setAttribute("cy", imgY + avatarSize / 2);
      borderCircle.setAttribute("r", avatarSize / 2);
      borderCircle.setAttribute("class", `chart-avatar-border chart-avatar-border-${config.class}`);
      svg.appendChild(borderCircle);
    }
  });

  container.appendChild(svg);
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
