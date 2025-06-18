// ===================================================
// CONFIGURATION SUPABASE POUR MYM FORMATION
// ===================================================

// Configuration Supabase - REMPLACEZ PAR VOS VRAIES CLÉS
const SUPABASE_CONFIG = {
    url: 'https://wnqxbflqiwkvaxzecjyv.supabase.co', // REMPLACEZ PAR VOTRE URL
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducXhiZmxxaXdrdmF4emVjanl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAyMDM4ODYsImV4cCI6MjA2NTc3OTg4Nn0.4cAmdfkVZx53TOOYwr-2LkUpr3sR26kF2orsE1WJkDg', // REMPLACEZ PAR VOTRE CLÉ ANONYME
    adminEmail: 'provider.global.fr@gmail.com', // REMPLACEZ PAR VOTRE EMAIL ADMIN
    adminPassword: 'pOURMONmym07§' // REMPLACEZ PAR VOTRE MOT DE PASSE
};

// Import Supabase (CDN)
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
document.head.appendChild(script);

let supabase;

// Initialiser Supabase quand le script est chargé
script.onload = function() {
    supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    console.log('✅ Supabase initialisé');
};

// ===================================================
// FONCTIONS UTILITAIRES
// ===================================================

// Générer un ID unique
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Formater la date
function formatDate(date) {
    return new Intl.DateTimeFormat('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

// Afficher un message toast
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: bold;
        z-index: 10000;
        animation: slideIn 0.3s ease;
        ${type === 'success' ? 'background: #10B981;' : 'background: #EF4444;'}
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===================================================
// FONCTIONS D'AUTHENTIFICATION ADMIN
// ===================================================

// Connexion administrateur
async function loginAdmin(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // Stocker l'état de connexion
        localStorage.setItem('admin_logged_in', 'true');
        localStorage.setItem('admin_email', email);

        showToast('Connexion administrateur réussie !');
        return true;
    } catch (error) {
        console.error('Erreur de connexion:', error);
        showToast('Erreur de connexion : ' + error.message, 'error');
        return false;
    }
}

// Vérifier si l'admin est connecté
function isAdminLoggedIn() {
    return localStorage.getItem('admin_logged_in') === 'true';
}

// Déconnexion admin
async function logoutAdmin() {
    await supabase.auth.signOut();
    localStorage.removeItem('admin_logged_in');
    localStorage.removeItem('admin_email');
    showToast('Déconnexion réussie');
}

// ===================================================
// FONCTIONS DE GESTION DES CODES D'ACCÈS (ADMIN)
// ===================================================

// Créer un nouveau code d'accès
async function createAccessCode(email, clientName, price, level, durationDays) {
    if (!isAdminLoggedIn()) {
        showToast('Vous devez être connecté en tant qu\'administrateur', 'error');
        return null;
    }

    try {
        const { data: user } = await supabase.auth.getUser();
        const userId = user?.user?.id;

        if (!userId) {
            throw new Error('Utilisateur non authentifié');
        }

        const { data, error } = await supabase.rpc('create_access_code', {
            p_email: email,
            p_client_name: clientName,
            p_price: parseFloat(price),
            p_level: parseInt(level),
            p_duration_days: parseInt(durationDays),
            p_created_by: userId
        });

        if (error) throw error;

        const result = data[0];
        showToast(`Code d\'accès créé : ${result.code}`);

        // Log de l'activité
        await logActivity('CODE_CREATED', {
            code: result.code,
            email: email,
            client_name: clientName,
            price: price,
            level: level
        });

        return result;
    } catch (error) {
        console.error('Erreur création code:', error);
        showToast('Erreur lors de la création : ' + error.message, 'error');
        return null;
    }
}

// Récupérer tous les codes d'accès de l'admin
async function getAccessCodes() {
    if (!isAdminLoggedIn()) return [];

    try {
        const { data, error } = await supabase
            .from('access_codes')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Erreur récupération codes:', error);
        return [];
    }
}

// Récupérer les statistiques admin
async function getAdminStats() {
    if (!isAdminLoggedIn()) return null;

    try {
        const { data, error } = await supabase
            .from('admin_stats')
            .select('*');

        if (error) throw error;
        return data[0] || {
            total_codes: 0,
            active_codes: 0,
            used_codes: 0,
            total_revenue: 0,
            average_price: 0,
            level_1_count: 0,
            level_2_count: 0,
            level_3_count: 0
        };
    } catch (error) {
        console.error('Erreur statistiques:', error);
        return null;
    }
}

// ===================================================
// FONCTIONS DE VÉRIFICATION UTILISATEUR
// ===================================================

// Vérifier un code d'accès utilisateur
async function verifyUserAccess(code, email) {
    try {
        const { data, error } = await supabase.rpc('verify_access_code', {
            p_code: code.toUpperCase(),
            p_email: email
        });

        if (error) throw error;

        const result = data[0];

        if (result.is_valid) {
            // Créer une session utilisateur
            const sessionToken = await createUserSession(code, email);

            if (sessionToken) {
                // Stocker les informations de session
                localStorage.setItem('user_session_token', sessionToken);
                localStorage.setItem('user_email', email);
                localStorage.setItem('user_level', result.level);
                localStorage.setItem('user_name', result.client_name || '');

                showToast('Accès validé avec succès !');
                return {
                    valid: true,
                    level: result.level,
                    clientName: result.client_name,
                    expiresAt: result.expires_at
                };
            }
        }

        showToast('Code d\'accès invalide ou expiré', 'error');
        return { valid: false };

    } catch (error) {
        console.error('Erreur vérification:', error);
        showToast('Erreur lors de la vérification', 'error');
        return { valid: false };
    }
}

// Créer une session utilisateur
async function createUserSession(code, email) {
    try {
        const { data, error } = await supabase.rpc('create_user_session', {
            p_code: code.toUpperCase(),
            p_email: email,
            p_ip_address: await getUserIP(),
            p_user_agent: navigator.userAgent
        });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Erreur création session:', error);
        return null;
    }
}

// Vérifier si l'utilisateur a accès à un niveau
function hasAccessToLevel(requiredLevel) {
    const userLevel = parseInt(localStorage.getItem('user_level') || '0');
    return userLevel >= requiredLevel;
}

// Vérifier si la session utilisateur est valide
function isUserSessionValid() {
    const token = localStorage.getItem('user_session_token');
    const email = localStorage.getItem('user_email');
    return token && email;
}

// ===================================================
// PROTECTION DES PAGES
// ===================================================

// Protéger une page selon le niveau requis
function protectPage(requiredLevel = 1) {
    if (!isUserSessionValid()) {
        window.location.href = '/index.html';
        return false;
    }

    if (!hasAccessToLevel(requiredLevel)) {
        showToast(`Accès refusé. Niveau ${requiredLevel} requis.`, 'error');
        setTimeout(() => {
            window.location.href = '/private/dashboard.html';
        }, 2000);
        return false;
    }

    return true;
}

// Détecter automatiquement le niveau requis selon l'URL
function autoProtectPage() {
    const path = window.location.pathname;

    let requiredLevel = 1; // Par défaut niveau 1

    if (path.includes('niveau-2') || path.includes('Bloc_6-2') || path.includes('Bloc_7') || path.includes('Bloc_8')) {
        requiredLevel = 2;
    } else if (path.includes('niveau-3') || path.includes('Bloc_9') || path.includes('Bloc_10') || path.includes('Bloc_11')) {
        requiredLevel = 3;
    }

    return protectPage(requiredLevel);
}

// ===================================================
// FONCTIONS UTILITAIRES
// ===================================================

// Obtenir l'IP de l'utilisateur
async function getUserIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch {
        return '0.0.0.0';
    }
}

// Logger une activité
async function logActivity(action, details = {}) {
    try {
        await supabase
            .from('activity_logs')
            .insert({
                action: action,
                details: details,
                ip_address: await getUserIP(),
                user_agent: navigator.userAgent
            });
    } catch (error) {
        console.error('Erreur log activité:', error);
    }
}

// ===================================================
// INITIALISATION AUTOMATIQUE
// ===================================================

// Auto-protection des pages au chargement
document.addEventListener('DOMContentLoaded', function() {
    // Protection automatique si on est dans le dossier private
    if (window.location.pathname.includes('/private/') && 
        !window.location.pathname.includes('dashboard.html') &&
        !window.location.pathname.includes('index.html')) {
        autoProtectPage();
    }

    // Ajouter les styles CSS pour les toasts
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
});

// Exposer les fonctions globalement
window.MYM_ACCESS = {
    // Admin functions
    loginAdmin,
    logoutAdmin,
    isAdminLoggedIn,
    createAccessCode,
    getAccessCodes,
    getAdminStats,

    // User functions
    verifyUserAccess,
    isUserSessionValid,
    hasAccessToLevel,
    protectPage,
    autoProtectPage,

    // Utilities
    showToast,
    formatDate
};

console.log('🚀 Système MYM Access chargé avec succès !');
