// ==UserScript==
// @name         Creation Tâche Automatique Changement Etat Devis
// @namespace    https://github.com/BiggerThanTheMall
// @version      10.4.0
// @description  Crée automatiquement une tâche liée au devis lors de sa création ou d'un changement d'état, sans second rafraîchissement, avec référent du devis et exécution plus rapide
// @author       BiggerThanTheMall
// @match        https://courtage.modulr.fr/*
// @icon         https://courtage.modulr.fr/images/favicons/favicon-32x32.png
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/tache_automatique/main/creation_tache_automatique_changement_etat_devis.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/tache_automatique/main/creation_tache_automatique_changement_etat_devis.user.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG_ETATS = {
        'pending_parts': {
            titre: "DEMANDE DE PIÈCES",
            note: "Relancer le client pour obtenir les éléments manquants et pouvoir éditer le devis.",
            delai: 1
        },
        'pricing': {
            titre: "DEVIS À FAIRE",
            note: "Réaliser la tarification et envoyer le devis sous 48h.",
            delai: 0
        },
        'delivered': {
            titre: "RELANCE DEVIS ENVOYÉ",
            note: "À relancer pour validation.",
            delai: 2
        },
        'pending_approval': {
            titre: "SUIVI MISE EN PLACE",
            note: "En attente de validation. Suivre la mise en place du contrat.",
            delai: 1
        }
    };

    const USER_ID_BY_LOGIN = {
        'dkalah': '33',
        'ekalah': '23',
        'gkalah': '24',
        'jcasimir': '28',
        'lvulliod': '36',
        'nkalah': '22',
        'skrief': '2',
        'youachbab': '39'
    };

    const USER_TEXT_MAPPING = [
        { id: '33', patterns: ['dkalah'] },
        { id: '23', patterns: ['ekalah', 'eddy kalah', 'eddy'] },
        { id: '24', patterns: ['gkalah', 'ghais kalah', 'ghaïs kalah', 'ghais', 'ghaïs'] },
        { id: '28', patterns: ['jcasimir', 'casimir'] },
        { id: '36', patterns: ['lvulliod', 'louli vulliod', 'louli'] },
        { id: '22', patterns: ['nkalah', 'nadia kalah', 'nadia'] },
        { id: '2', patterns: ['skrief', 'sheana krief', 'shéana krief', 'sheana', 'shéana'] },
        { id: '39', patterns: ['youachbab', 'ouachbab'] }
    ];

    const STORAGE = {
        donePrefix: 'modulr_auto_task_done_'
    };

    const DONE_DURATION_MS = 24 * 60 * 60 * 1000;

    let isProcessing = false;
    let lastSubmitter = null;

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeUserId(value) {
        if (!value) {
            return '';
        }

        const match = String(value).match(/\d+/);

        return match ? match[0] : '';
    }

    function getActiveUserId() {
        const cookieMatch = document.cookie
            .split('; ')
            .find(row => row.startsWith('modulr_user='));

        const userName = cookieMatch
            ? decodeURIComponent(cookieMatch.split('=')[1])
            : 'gkalah';

        return USER_ID_BY_LOGIN[userName] || "24";
    }

    function formatDate(daysToAdd) {
        const d = new Date();
        d.setDate(d.getDate() + daysToAdd);
        return d.toLocaleDateString('fr-FR');
    }

    function getClientIdFromUrl(urlValue) {
        try {
            const url = new URL(urlValue, window.location.origin);
            const params = new URLSearchParams(url.search);

            return (
                params.get('id') ||
                params.get('client_id') ||
                params.get('entity_id') ||
                ''
            );
        } catch (error) {
            return '';
        }
    }

    function getClientIdFromCurrentUrl() {
        return getClientIdFromUrl(window.location.href);
    }

    function getParamFromUrl(urlValue, paramName) {
        try {
            const url = new URL(urlValue, window.location.origin);
            return url.searchParams.get(paramName) || '';
        } catch (error) {
            return '';
        }
    }

    function simpleHash(value) {
        let hash = 0;

        if (!value) {
            return '0';
        }

        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash) + value.charCodeAt(i);
            hash |= 0;
        }

        return String(Math.abs(hash));
    }

    function getFormDataWithSubmitter(form, submitter) {
        const formData = new FormData(form);

        if (
            submitter &&
            submitter.name &&
            !submitter.disabled &&
            !formData.has(submitter.name)
        ) {
            formData.append(submitter.name, submitter.value || '');
        }

        return formData;
    }

    function makeFormHash(formData) {
        const entries = [];

        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                entries.push(key + '=' + value.name + ':' + value.size);
            } else {
                entries.push(key + '=' + String(value));
            }
        }

        entries.sort();

        return simpleHash(entries.join('&'));
    }

    function makeTaskSignature(data, estimateId) {
        return [
            data.statusKey || '',
            data.clientId || '',
            estimateId || data.formHash || '',
            data.userId || '',
            new Date().toISOString().slice(0, 10)
        ].join('|');
    }

    function cleanOldDoneKeys() {
        const now = Date.now();

        Object.keys(sessionStorage).forEach(key => {
            if (!key.startsWith(STORAGE.donePrefix)) {
                return;
            }

            const timestamp = Number(sessionStorage.getItem(key));

            if (!timestamp || now - timestamp > DONE_DURATION_MS) {
                sessionStorage.removeItem(key);
            }
        });
    }

    function getEstimateIdFromForm(form) {
        return (
            form.querySelector('[name="estimate[id]"]')?.value ||
            form.querySelector('[name="estimate_id"]')?.value ||
            form.querySelector('[name="id_estimate"]')?.value ||
            getParamFromUrl(window.location.href, 'estimate_id') ||
            getParamFromUrl(window.location.href, 'id_estimate') ||
            ''
        );
    }

    function getStatusKeyFromForm(form) {
        return (
            form.querySelector('[name="estimate[status]"]')?.value ||
            form.querySelector('[name="estimate[status_key]"]')?.value ||
            form.querySelector('[name="status_key"]')?.value ||
            ''
        );
    }

    function getClientIdFromForm(form) {
        return (
            form.querySelector('[name="estimate[client_id]"]')?.value ||
            form.querySelector('[name="client_id"]')?.value ||
            form.querySelector('[name="entity_id"]')?.value ||
            getClientIdFromCurrentUrl() ||
            ''
        );
    }

    function getReferentUserIdFromForm(form) {
        const selectors = [
            '[name="estimate[referent_user_id]"]',
            '[name="referent_user_id"]',
            '[name*="referent_user_id"]',
            '[name*="referent"][name*="user"]'
        ];

        for (const selector of selectors) {
            const field = form.querySelector(selector);

            if (field && field.value) {
                const userId = normalizeUserId(field.value);

                if (userId) {
                    return userId;
                }
            }
        }

        return '';
    }

    function findEstimateIdInHtml(html) {
        if (!html) {
            return '';
        }

        const ids = [];

        const regexes = [
            /element_toggle_estimate_(\d+)/g,
            /EstimateData:(\d+)/g,
            /estimate_id["'=:\s]+(\d+)/g,
            /selected_subentity_id["'=:\s]+EstimateData:(\d+)/g,
            /id_estimate["'=:\s]+(\d+)/g
        ];

        regexes.forEach(regex => {
            let match;

            while ((match = regex.exec(html)) !== null) {
                if (match[1] && /^\d+$/.test(match[1])) {
                    ids.push(Number(match[1]));
                }
            }
        });

        if (ids.length === 0) {
            return '';
        }

        return String(Math.max(...ids));
    }

    function findLastEstimateIdOnCurrentPage() {
        const elements = Array.from(
            document.querySelectorAll('[id*="element_toggle_estimate_"]')
        );

        const ids = elements
            .map(el => el.id.replace('element_toggle_estimate_', ''))
            .filter(id => /^\d+$/.test(id))
            .map(Number);

        if (ids.length === 0) {
            return '';
        }

        return String(Math.max(...ids));
    }

    function getFinalUrlAfterFetch(response, fallbackUrl) {
        if (response && response.url) {
            return response.url;
        }

        return fallbackUrl || window.location.href;
    }

    function findEstimateContainerFromLink(link, estimateId) {
        const directContainer = link.closest(
            'tr, li, .card, .panel, .box, .well, [class*="estimate"], [id*="estimate"], [class*="devis"], [id*="devis"]'
        );

        if (directContainer) {
            return directContainer;
        }

        let node = link.parentElement;
        let depth = 0;

        while (node && node !== document.body && depth < 12) {
            if (estimateId) {
                const hasSameEstimateLink = node.querySelector(
                    'a[href*="estimate_id=' + estimateId + '"], a[href*="id_estimate=' + estimateId + '"]'
                );

                const hasSameEstimateElement = node.querySelector(
                    '[id*="element_toggle_estimate_' + estimateId + '"], [id*="estimate_' + estimateId + '"]'
                );

                if (hasSameEstimateLink || hasSameEstimateElement) {
                    return node;
                }
            }

            node = node.parentElement;
            depth++;
        }

        return link.parentElement || document.body;
    }

    function extractUserIdFromElement(root) {
        if (!root) {
            return '';
        }

        const fieldSelectors = [
            '[name="estimate[referent_user_id]"]',
            '[name="referent_user_id"]',
            '[name*="referent_user_id"]',
            '[name*="referent"][name*="user"]',
            '[data-referent-user-id]',
            '[data-user-id]',
            '[data-user]'
        ];

        for (const selector of fieldSelectors) {
            const element = root.querySelector(selector);

            if (!element) {
                continue;
            }

            const possibleValues = [
                element.value,
                element.getAttribute('data-referent-user-id'),
                element.getAttribute('data-user-id'),
                element.getAttribute('data-user')
            ];

            for (const value of possibleValues) {
                const userId = normalizeUserId(value);

                if (userId) {
                    return userId;
                }
            }
        }

        const attributesToRead = [
            'title',
            'alt',
            'aria-label',
            'data-original-title',
            'data-title'
        ];

        let textToAnalyze = normalizeText(root.textContent || '');

        root.querySelectorAll('*').forEach(element => {
            attributesToRead.forEach(attr => {
                const attrValue = element.getAttribute(attr);

                if (attrValue) {
                    textToAnalyze += ' ' + normalizeText(attrValue);
                }
            });
        });

        for (const item of USER_TEXT_MAPPING) {
            for (const pattern of item.patterns) {
                const normalizedPattern = normalizeText(pattern);

                if (textToAnalyze.includes(normalizedPattern)) {
                    return item.id;
                }
            }
        }

        return '';
    }

    function getReferentUserIdFromStatusCard(link, estimateId) {
        const url = new URL(link.href, window.location.origin);

        const userFromUrl =
            normalizeUserId(url.searchParams.get('referent_user_id')) ||
            normalizeUserId(url.searchParams.get('user_id')) ||
            normalizeUserId(url.searchParams.get('referent_id'));

        if (userFromUrl) {
            return userFromUrl;
        }

        const container = findEstimateContainerFromLink(link, estimateId);
        const userFromContainer = extractUserIdFromElement(container);

        if (userFromContainer) {
            return userFromContainer;
        }

        console.warn(
            "[Modulr Auto Task] Référent du devis non trouvé dans la carte. Utilisateur connecté utilisé en secours."
        );

        return getActiveUserId();
    }

    async function createTask(data, estimateId) {
        const config = CONFIG_ETATS[data.statusKey];

        if (!config) {
            throw new Error("État non configuré : " + data.statusKey);
        }

        if (!data.clientId || !data.userId) {
            throw new Error("Données insuffisantes pour créer la tâche.");
        }

        const signature = makeTaskSignature(data, estimateId);

        if (sessionStorage.getItem(STORAGE.donePrefix + signature)) {
            console.warn("[Modulr Auto Task] Tâche déjà créée, aucune nouvelle requête envoyée :", signature);

            return {
                alreadyDone: true,
                signature
            };
        }

        const body = new URLSearchParams();

        body.append("action", "send");
        body.append("mode", "create");
        body.append("entity_id", data.clientId);
        body.append("class_name", "Client");
        body.append("task_mode", "from_scratch");
        body.append("task[name]", config.titre);
        body.append("task[recall_date]", formatDate(config.delai));
        body.append("task_actors_list_id", "user:" + data.userId);
        body.append("task[event_type]", "195");
        body.append("task[notes]", config.note);

        if (estimateId) {
            body.append("task_related_to_entity", "EstimateData");
            body.append("selected_subentity_id", "EstimateData:" + estimateId);
        }

        const response = await fetch("https://courtage.modulr.fr/fr/scripts/Tasks/TasksManage.php", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: body.toString()
        });

        if (!response.ok) {
            throw new Error("Erreur serveur lors de la création de la tâche : " + response.status);
        }

        sessionStorage.setItem(STORAGE.donePrefix + signature, String(Date.now()));

        console.log("[Modulr Auto Task] Tâche créée :", {
            titre: config.titre,
            clientId: data.clientId,
            estimateId: estimateId || '',
            userId: data.userId
        });

        return {
            alreadyDone: false,
            signature
        };
    }

    async function runNativeFormSubmitByFetch(form, submitter, needHtml = false) {
        const method = (form.method || 'POST').toUpperCase();
        const actionUrl = new URL(
            form.getAttribute('action') || window.location.href,
            window.location.href
        );

        const formData = getFormDataWithSubmitter(form, submitter);

        let response;

        if (method === 'GET') {
            const params = new URLSearchParams();

            for (const [key, value] of formData.entries()) {
                if (!(value instanceof File)) {
                    params.append(key, String(value));
                }
            }

            actionUrl.search = params.toString();

            response = await fetch(actionUrl.href, {
                method: "GET",
                credentials: "same-origin",
                redirect: "follow"
            });
        } else {
            response = await fetch(actionUrl.href, {
                method: "POST",
                credentials: "same-origin",
                redirect: "follow",
                body: formData
            });
        }

        if (!response.ok) {
            throw new Error("Erreur Modulr lors de l'enregistrement du devis : " + response.status);
        }

        const html = needHtml ? await response.text() : '';

        return {
            response,
            html,
            finalUrl: getFinalUrlAfterFetch(response, response.url || window.location.href),
            formData
        };
    }

    function submitFormNatively(form, submitter) {
        if (submitter && submitter.name) {
            const hidden = document.createElement('input');
            hidden.type = 'hidden';
            hidden.name = submitter.name;
            hidden.value = submitter.value || '';
            hidden.setAttribute('data-modulr-auto-task-submit', '1');

            form.appendChild(hidden);
        }

        HTMLFormElement.prototype.submit.call(form);
    }

    async function handleEstimateStatusUpdate(link, event) {
        if (event.defaultPrevented) {
            return;
        }

        if (event.button !== undefined && event.button !== 0) {
            return;
        }

        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        if (isProcessing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        const url = new URL(link.href, window.location.origin);
        const statusKey = url.searchParams.get('status_key');

        if (!CONFIG_ETATS[statusKey]) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        isProcessing = true;

        const estimateId = url.searchParams.get('estimate_id') || url.searchParams.get('id_estimate') || '';

        const data = {
            statusKey: statusKey,
            estimateId: estimateId,
            clientId: getClientIdFromCurrentUrl() || url.searchParams.get('client_id') || url.searchParams.get('entity_id') || '',
            userId: getReferentUserIdFromStatusCard(link, estimateId),
            formHash: ''
        };

        try {
            await createTask(data, estimateId);

            window.location.href = link.href;

        } catch (error) {
            console.error("[Modulr Auto Task] Erreur changement d'état :", error);

            isProcessing = false;

            alert(
                "La tâche automatique n'a pas pu être créée.\n\n" +
                "Le changement d'état n'a pas été lancé afin d'éviter une incohérence.\n\n" +
                "Merci de vérifier dans Modulr avant de refaire l'action."
            );
        }
    }

    async function handleEstimateFormSubmit(form, submitter, event) {
        if (!form) {
            return;
        }

        const statusKey = getStatusKeyFromForm(form);

        if (!CONFIG_ETATS[statusKey]) {
            return;
        }

        if (isProcessing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (event.type === 'click' && typeof form.reportValidity === 'function') {
            if (!form.reportValidity()) {
                return;
            }
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        isProcessing = true;

        const initialFormData = getFormDataWithSubmitter(form, submitter);
        const initialEstimateId = getEstimateIdFromForm(form);

        const data = {
            statusKey: statusKey,
            estimateId: initialEstimateId,
            clientId: getClientIdFromForm(form),
            userId: getReferentUserIdFromForm(form) || getActiveUserId(),
            formHash: makeFormHash(initialFormData)
        };

        try {
            if (initialEstimateId) {
                await createTask(data, initialEstimateId);

                submitFormNatively(form, submitter);
                return;
            }

            const nativeResult = await runNativeFormSubmitByFetch(form, submitter, true);

            const estimateId =
                findEstimateIdInHtml(nativeResult.html) ||
                findLastEstimateIdOnCurrentPage() ||
                '';

            await createTask(data, estimateId);

            window.location.href = nativeResult.finalUrl;

        } catch (error) {
            console.error("[Modulr Auto Task] Erreur enregistrement devis :", error);

            isProcessing = false;

            alert(
                "L'enregistrement du devis ou la création de la tâche automatique n'a pas pu être confirmé.\n\n" +
                "Merci de vérifier dans Modulr avant de refaire l'action, afin d'éviter une double tâche."
            );
        }
    }

    document.addEventListener('click', function(event) {
        const link = event.target.closest('a');

        if (link && link.href && link.href.includes('estimates_update.php')) {
            handleEstimateStatusUpdate(link, event);
            return;
        }

        const submitButton = event.target.closest('button[type="submit"], input[type="submit"]');

        if (submitButton && submitButton.form) {
            lastSubmitter = submitButton;

            const form = submitButton.form;
            const statusKey = getStatusKeyFromForm(form);

            if (CONFIG_ETATS[statusKey]) {
                handleEstimateFormSubmit(form, submitButton, event);
            }
        }
    }, true);

    document.addEventListener('submit', function(event) {
        const form = event.target;

        if (!form) {
            return;
        }

        handleEstimateFormSubmit(form, lastSubmitter || event.submitter || null, event);
    }, true);

    window.addEventListener('load', function() {
        cleanOldDoneKeys();
    });

})();
