// ==UserScript==
// @name         Creation Tâche Automatique Changement Etat Devis
// @namespace    https://github.com/BiggerThanTheMall
// @version      11.2.8
// @description  Crée automatiquement une tâche liée au bon client, au bon devis et au bon référent lors de la création ou du changement d'état d'un devis.
// @author       BiggerThanTheMall
// @match        https://courtage.modulr.fr/*
// @icon         https://courtage.modulr.fr/images/favicons/favicon-32x32.png
// @grant        none
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/tache_automatique/main/creation_tache_automatique_changement_etat_devis.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/tache_automatique/main/creation_tache_automatique_changement_etat_devis.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '11.2.8';
    const DEBUG = true;

    const CONFIG_ETATS = {
        pending_parts: {
            titre: 'DEMANDE DE PIÈCES',
            note: 'Relancer le client pour obtenir les éléments manquants et pouvoir éditer le devis.',
            delai: 1
        },
        pricing: {
            titre: 'DEVIS À FAIRE',
            note: 'Réaliser la tarification et envoyer le devis sous 48h.',
            delai: 0
        },
        delivered: {
            titre: 'RELANCE DEVIS ENVOYÉ',
            note: 'À relancer pour validation.',
            delai: 2
        },
        pending_approval: {
            titre: 'SUIVI MISE EN PLACE',
            note: 'En attente de validation. Suivre la mise en place du contrat.',
            delai: 1
        }
    };

    const USER_ID_BY_LOGIN = {
        dkalah: '33',
        ekalah: '23',
        gkalah: '24',
        jcasimir: '28',
        lvulliod: '36',
        nkalah: '22',
        skrief: '2',
        youachbab: '39'
    };

    const USER_NAME_BY_ID = {
        '33': 'D. Kalah',
        '23': 'Eddy Kalah',
        '24': 'Ghais Kalah',
        '28': 'J. Casimir',
        '36': 'Louli Vulliod',
        '22': 'Nadia Kalah',
        '2': 'Sheana Krief',
        '39': 'Youachbab'
    };

    const USER_TEXT_MAPPING = [
        { id: '33', patterns: ['dkalah'] },
        { id: '23', patterns: ['ekalah', 'eddy kalah', 'eddy'] },
        { id: '24', patterns: ['gkalah', 'ghais kalah', 'ghaïs kalah', 'ghais', 'ghaïs'] },
        { id: '28', patterns: ['jcasimir', 'casimir', 'jake'] },
        { id: '36', patterns: ['lvulliod', 'louli vulliod', 'louli'] },
        { id: '22', patterns: ['nkalah', 'nadia kalah', 'nadia'] },
        { id: '2', patterns: ['skrief', 'sheana krief', 'shéana krief', 'sheana', 'shéana'] },
        { id: '39', patterns: ['youachbab', 'ouachbab'] }
    ];

    const STORAGE_PREFIX = 'modulr_auto_task_done_';
    const DONE_DURATION_MS = 24 * 60 * 60 * 1000;

    let isProcessing = false;
    let lastSubmitter = null;

    function log(...args) {
        if (!DEBUG) return;

        console.log(
            '%c[Modulr Auto Task]',
            'background:#0057b8;color:#fff;font-weight:bold;padding:2px 5px;border-radius:3px;',
            ...args
        );
    }

    function warn(...args) {
        console.warn(
            '[Modulr Auto Task]',
            ...args
        );
    }

    function error(...args) {
        console.error(
            '[Modulr Auto Task]',
            ...args
        );
    }

    function section(title) {
        if (!DEBUG) return;

        console.log('');

        console.log(
            `%c========== ${title} ==========`,
            'color:#0057b8;font-size:14px;font-weight:bold;'
        );
    }

    log(`VERSION ${VERSION} CHARGÉE`);

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

        const match =
            String(value)
                .match(/\d+/);

        return match
            ? match[0]
            : '';
    }

    function normalizeEstimateId(value) {
        const id =
            String(value || '')
                .trim();

        if (
            !id ||
            id === '0' ||
            !/^\d+$/.test(id)
        ) {
            return '';
        }

        return id;
    }

    function addValidEstimateId(
        set,
        value
    ) {
        const id =
            normalizeEstimateId(
                value
            );

        if (id) {
            set.add(id);
        }
    }

    function getParamFromUrl(
        urlValue,
        paramName
    ) {
        try {
            return new URL(
                urlValue,
                window.location.origin
            )
                .searchParams
                .get(paramName)
                ||
                '';

        } catch (_) {
            return '';
        }
    }

    function getClientIdFromUrl(
        urlValue
    ) {
        try {
            const url =
                new URL(
                    urlValue,
                    window.location.origin
                );

            return (
                url.searchParams.get('client_id') ||
                url.searchParams.get('entity_id') ||
                url.searchParams.get('id') ||
                ''
            );

        } catch (_) {
            return '';
        }
    }

    function getActiveUserInfo() {
        const cookie =
            document.cookie
                .split('; ')
                .find(
                    row =>
                        row.startsWith(
                            'modulr_user='
                        )
                );

        const login =
            cookie
                ? decodeURIComponent(
                    cookie.substring(
                        'modulr_user='.length
                    )
                )
                : '';

        const userId =
            USER_ID_BY_LOGIN[
                login
            ]
            ||
            '';

        return {
            userId,

            login,

            displayName:
                USER_NAME_BY_ID[userId]
                ||
                login
                ||
                'Utilisateur inconnu',

            source:
                'utilisateur connecté — fallback final'
        };
    }

    function formatDate(
        daysToAdd
    ) {
        const d =
            new Date();

        d.setDate(
            d.getDate() +
            daysToAdd
        );

        return d.toLocaleDateString(
            'fr-FR'
        );
    }

    function getVisibleClientTaskButtonId(
        root = document
    ) {
        const buttons =
            Array.from(
                root.querySelectorAll(
                    'a.task_manage[id^="task:0:"][id*="entity_id:"]'
                )
            );

        const preferred =
            buttons.find(
                btn =>
                    btn.offsetParent !== null
                    &&
                    /entity_name:Client:entity_id:\d+/i
                        .test(
                            btn.id || ''
                        )
            )
            ||
            buttons.find(
                btn =>
                    /entity_name:Client:entity_id:\d+/i
                        .test(
                            btn.id || ''
                        )
            );

        if (!preferred) {
            return '';
        }

        const match =
            (preferred.id || '')
                .match(
                    /entity_id:(\d+)/i
                );

        return match
            ? match[1]
            : '';
    }

    function getClientIdFromFormDetailed(
        form
    ) {
        const selectors = [
            '[name="estimate[client_id]"]',
            '[name="client_id"]'
        ];

        for (
            const selector
            of selectors
        ) {
            const field =
                form.querySelector(
                    selector
                );

            if (
                field &&
                field.value
            ) {
                return {
                    clientId:
                        String(
                            field.value
                        ),

                    source:
                        `formulaire ${selector}`
                };
            }
        }

        const taskButtonClientId =
            getVisibleClientTaskButtonId(
                document
            );

        if (
            taskButtonClientId
        ) {
            return {
                clientId:
                    taskButtonClientId,

                source:
                    'bouton tâche visible de la fiche client'
            };
        }

        const urlClientId =
            getClientIdFromUrl(
                window.location.href
            );

        if (
            urlClientId
        ) {
            return {
                clientId:
                    urlClientId,

                source:
                    'URL de la fiche client'
            };
        }

        const genericEntityField =
            form.querySelector(
                '[name="entity_id"]'
            );

        if (
            genericEntityField &&
            genericEntityField.value
        ) {
            return {
                clientId:
                    String(
                        genericEntityField.value
                    ),

                source:
                    'fallback formulaire [name="entity_id"]'
            };
        }

        return {
            clientId: '',
            source: 'introuvable'
        };
    }

    function getStatusKeyFromForm(
        form
    ) {
        return (
            form
                .querySelector(
                    '[name="estimate[status]"]'
                )
                ?.value

            ||

            form
                .querySelector(
                    '[name="estimate[status_key]"]'
                )
                ?.value

            ||

            form
                .querySelector(
                    '[name="status_key"]'
                )
                ?.value

            ||

            ''
        );
    }

    function getReferentUserIdFromFormDetailed(form) {
        return readRoleDetailed(form, 'referent');
    }

    function getEstimateIdFromForm(
        form
    ) {
        const candidates = [
            {
                source:
                    '[name="estimate[id]"]',

                value:
                    form
                        .querySelector(
                            '[name="estimate[id]"]'
                        )
                        ?.value
            },
            {
                source:
                    '[name="estimate_id"]',

                value:
                    form
                        .querySelector(
                            '[name="estimate_id"]'
                        )
                        ?.value
            },
            {
                source:
                    '[name="id_estimate"]',

                value:
                    form
                        .querySelector(
                            '[name="id_estimate"]'
                        )
                        ?.value
            }
        ];

        const selectedSubentity =
            form
                .querySelector(
                    '[name="selected_subentity_id"]'
                )
                ?.value;

        const selectedMatch =
            String(
                selectedSubentity || ''
            )
                .match(
                    /^EstimateData:(\d+)$/i
                );

        if (
            selectedMatch
        ) {
            candidates.push({
                source:
                    'selected_subentity_id',

                value:
                    selectedMatch[1]
            });
        }

        const formAction =
            form.getAttribute(
                'action'
            )
            ||
            form.action
            ||
            '';

        candidates.push(
            {
                source:
                    'URL action form / estimate_id',

                value:
                    getParamFromUrl(
                        formAction,
                        'estimate_id'
                    )
            },

            {
                source:
                    'URL action form / id_estimate',

                value:
                    getParamFromUrl(
                        formAction,
                        'id_estimate'
                    )
            },

            {
                source:
                    'URL actuelle / estimate_id',

                value:
                    getParamFromUrl(
                        window.location.href,
                        'estimate_id'
                    )
            },

            {
                source:
                    'URL actuelle / id_estimate',

                value:
                    getParamFromUrl(
                        window.location.href,
                        'id_estimate'
                    )
            }
        );

        // An explicit creation URL/field must not inherit an older estimate
        // found elsewhere in a parent of the form.
        if (!candidates.some(candidate => normalizeEstimateId(candidate.value)) &&
            candidates.some(candidate => String(candidate.value).trim() === '0')) {
            log('Nouveau devis explicitement identifié (ID 0).');
            return '';
        }

        let node =
            form;

        let depth =
            0;

        while (
            node &&
            node !== document.body &&
            depth < 12
        ) {
            const ownMatch =
                String(
                    node.id || ''
                )
                    .match(
                        /element_toggle_estimate_(\d+)/i
                    );

            if (
                ownMatch
            ) {
                candidates.push({
                    source:
                        `conteneur parent niveau ${depth}`,

                    value:
                        ownMatch[1]
                });
            }

            const estimateElement =
                node.querySelector?.(
                    '[id*="element_toggle_estimate_"]'
                );

            const childMatch =
                String(
                    estimateElement?.id || ''
                )
                    .match(
                        /element_toggle_estimate_(\d+)/i
                    );

            if (
                childMatch
            ) {
                candidates.push({
                    source:
                        `élément devis dans le contexte niveau ${depth}`,

                    value:
                        childMatch[1]
                });
            }

            node =
                node.parentElement;

            depth++;
        }

        log(
            'Candidats ID devis :',
            candidates
        );

        console.table(
            candidates.map(
                candidate => ({
                    source:
                        candidate.source,

                    valeur:
                        candidate.value || '',

                    valide:
                        Boolean(
                            normalizeEstimateId(
                                candidate.value
                            )
                        )
                })
            )
        );

        for (
            const candidate
            of candidates
        ) {
            const estimateId =
                normalizeEstimateId(
                    candidate.value
                );

            if (
                estimateId
            ) {
                log(
                    '✅ ID devis trouvé :',
                    {
                        estimateId,

                        source:
                            candidate.source
                    }
                );

                return estimateId;
            }
        }

        warn(
            '⚠️ Aucun ID réel de devis trouvé dans le formulaire ou son contexte.'
        );

        return '';
    }

    function collectEstimateIdsFromRoot(
        root
    ) {
        const ids =
            new Set();

        if (
            !root ||
            !root.querySelectorAll
        ) {
            return ids;
        }

        root
            .querySelectorAll(
                '[id*="element_toggle_estimate_"], [id*="element_toggle_EstimateData_"], [data-class_name="EstimateData"][data-entity_id]'
            )
            .forEach(
                el => {
                    const match =
                        String(
                            el.id || ''
                        )
                            .match(
                                /element_toggle_(?:estimate|EstimateData)_(\d+)/i
                            );

                    const dataEntityId = el.getAttribute?.('data-entity_id');

                    if (!match && dataEntityId) {
                        addValidEstimateId(ids, dataEntityId);
                    }

                    if (
                        match
                    ) {
                        addValidEstimateId(
                            ids,
                            match[1]
                        );
                    }
                }
            );

        root
            .querySelectorAll(
                'a[href*="estimate_id="], a[href*="id_estimate="]'
            )
            .forEach(
                link => {
                    try {
                        const url =
                            new URL(
                                link.getAttribute(
                                    'href'
                                )
                                ||
                                '',

                                window.location.origin
                            );

                        addValidEstimateId(
                            ids,

                            url.searchParams
                                .get(
                                    'estimate_id'
                                )
                        );

                        addValidEstimateId(
                            ids,

                            url.searchParams
                                .get(
                                    'id_estimate'
                                )
                        );

                    } catch (_) {
                        // Ignoré.
                    }
                }
            );

        root
            .querySelectorAll(
                '[value^="EstimateData:"]'
            )
            .forEach(
                el => {
                    const match =
                        String(
                            el.value || ''
                        )
                            .match(
                                /^EstimateData:(\d+)$/i
                            );

                    if (
                        match
                    ) {
                        addValidEstimateId(
                            ids,
                            match[1]
                        );
                    }
                }
            );

        return ids;
    }

    function collectEstimateIdsFromHtml(
        html
    ) {
        const ids =
            new Set();

        if (
            !html
        ) {
            return ids;
        }

        const doc =
            new DOMParser()
                .parseFromString(
                    html,
                    'text/html'
                );

        collectEstimateIdsFromRoot(
            doc
        )
            .forEach(
                id =>
                    ids.add(
                        id
                    )
            );

        const regexes = [
            /element_toggle_(?:estimate|EstimateData)_(\d+)/gi,
            /EstimateData:(\d+)/gi,
            /[?&](?:estimate_id|id_estimate)=(\d+)/gi
        ];

        for (
            const regex
            of regexes
        ) {
            let match;

            while (
                (
                    match =
                    regex.exec(
                        html
                    )
                )
                !==
                null
            ) {
                addValidEstimateId(
                    ids,
                    match[1]
                );
            }
        }

        return ids;
    }

    function getEstimateIdFromFinalUrl(
        finalUrl
    ) {
        const openParam =
            getParamFromUrl(
                finalUrl,
                'open'
            );

        const openMatch =
            String(
                openParam || ''
            )
                .match(
                    /^element_toggle_(?:estimate|EstimateData)_(\d+)$/i
                );

        if (
            openMatch
        ) {
            const estimateId =
                normalizeEstimateId(
                    openMatch[1]
                );

            if (
                estimateId
            ) {
                log(
                    '✅ ID devis trouvé directement dans le paramètre open de l’URL finale :',
                    estimateId
                );

                return estimateId;
            }
        }

        return (
            normalizeEstimateId(
                getParamFromUrl(
                    finalUrl,
                    'estimate_id'
                )
            )

            ||

            normalizeEstimateId(
                getParamFromUrl(
                    finalUrl,
                    'id_estimate'
                )
            )

            ||

            ''
        );
    }

    function findEstimateAnchorInRoot(
        root,
        estimateId
    ) {
        if (
            !root ||
            !root.querySelector ||
            !estimateId
        ) {
            return null;
        }

        const id =
            String(
                estimateId
            );

        const selectors = [
            // Structure réelle de la fiche client Modulr observée en production.
            `[data-class_name="EstimateData"][data-entity_id="${CSS.escape(id)}"]`,
            `#element_toggle_EstimateData_${CSS.escape(id)}`,
            `#container_EstimateData_${CSS.escape(id)}`,
            `#element_toggle_estimate_${CSS.escape(id)}`,
            `[data-estimate-id="${CSS.escape(id)}"]`,
            `[value="EstimateData:${CSS.escape(id)}"]`,
            // Les liens arrivent en dernier : sinon on s'arrête dans le <li> du menu d'état.
            `a[href*="estimate_id=${encodeURIComponent(id)}"]`,
            `a[href*="id_estimate=${encodeURIComponent(id)}"]`
        ];

        for (
            const selector
            of selectors
        ) {
            try {
                const found =
                    root.querySelector(
                        selector
                    );

                if (
                    found
                ) {
                    return found;
                }

            } catch (_) {
                // Ignoré.
            }
        }

        return null;
    }

    function findEstimateContainerInRoot(root, estimateId) {
        const anchor = findEstimateAnchorInRoot(root, estimateId);
        if (!anchor) return null;
        // Stop before a parent containing another estimate: never read its owner.
        let node = anchor;
        let best = anchor;
        while (node && node !== root.body && node !== root.documentElement) {
            const ids = collectEstimateIdsFromRoot(node);
            if (Array.from(ids).some(id => id !== String(estimateId))) break;
            best = node;
            if (node.matches?.('tr, li, .card, .panel, .box, .well')) return node;
            node = node.parentElement;
        }
        return best;
    }

    function parseAssignedUserId(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '';

        // Modulr peut renvoyer l'identifiant sous plusieurs formes selon le widget
        // (36, user:36, UserData:36, valeur sérialisée, etc.).
        const numericTokens = raw.match(/\d+/g) || [];
        const unique = Array.from(new Set(numericTokens.filter(token => /^[1-9]\d*$/.test(token))));
        return unique.length === 1 ? unique[0] : '';
    }

    function identifyUserText(text) {
        const normalized = normalizeText(text);
        const ids = new Set();
        for (const user of USER_TEXT_MAPPING) {
            if (user.patterns.some(pattern => {
                const needle = normalizeText(pattern);
                const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])').test(normalized);
            })) ids.add(user.id);
        }
        return ids.size === 1 ? Array.from(ids)[0] : '';
    }

    function roleResult(state, userId = '', source = '') {
        return { state, userId, source };
    }

    function readRoleControl(field, role) {
        const source = `${role} champ ${field.name || field.id || field.tagName}`;
        if (field.matches('select')) {
            if (field.multiple || field.getAttribute('aria-busy') === 'true' ||
                field.matches('[data-loading="true"], .loading') ||
                !field.options.length) return roleResult('unknown', '', source + ' en chargement');
            // Only the selected option/value; never scan all available collaborators.
            const selected = field.selectedOptions[0];
            if (!selected) return roleResult('unknown', '', source);
            const value = String(field.value || '').trim();
            const id = parseAssignedUserId(value);
            if (id) return roleResult('assigned', id, source);
            if (value && value !== '0') {
                const textId = identifyUserText(selected.textContent);
                return roleResult(textId ? 'assigned' : 'unknown', textId, source);
            }
            const placeholder = normalizeText(selected.textContent);
            if (/charg|loading/.test(placeholder)) return roleResult('unknown', '', source);
            // A placeholder-only list can still be waiting for its options.
            if (field.options.length === 1 && !/aucun|non renseigne|sans referent|sans binome/.test(placeholder))
                return roleResult('unknown', '', source);
            return roleResult('empty', '', source);
        }
        const rawValues = [
            field.value,
            field.getAttribute('data-' + role + '-user-id'),
            field.getAttribute('data-user-id'),
            field.getAttribute('data-value'),
            field.getAttribute('data-id')
        ].filter(value => value !== null && value !== undefined);

        for (const value of rawValues) {
            const id = parseAssignedUserId(value);
            if (id) return roleResult('assigned', id, source);
        }

        // Select2 / widgets Modulr : la vraie valeur peut être affichée à côté du champ
        // alors que l'input technique reste vide.
        const widgetCandidates = [];
        if (field.id) {
            const escapedId = CSS.escape(field.id);
            widgetCandidates.push(
                field.ownerDocument?.querySelector('#s2id_' + escapedId),
                field.ownerDocument?.querySelector('#' + escapedId + '_chosen')
            );
        }
        widgetCandidates.push(field.nextElementSibling, field.parentElement?.querySelector('.select2-chosen, .select2-selection__rendered'));

        for (const widget of widgetCandidates.filter(Boolean)) {
            const id = identifyUserText(
                (widget.textContent || '') + ' ' +
                (widget.getAttribute?.('title') || '') + ' ' +
                (widget.getAttribute?.('data-original-title') || '')
            );
            if (id) return roleResult('assigned', id, source + ' via widget');
        }

        const hasExplicitEmpty = rawValues.some(value => String(value).trim() === '' || String(value).trim() === '0');
        if (hasExplicitEmpty) return roleResult('empty', '', source);
        return roleResult('unknown', '', source);
    }

    function mergeRoleResults(results, role) {
        if (!results.length) return roleResult('unknown', '', role + ' non lisible');
        const ids = new Set(results.filter(r => r.state === 'assigned').map(r => r.userId));
        if (ids.size > 1 || results.some(r => r.state === 'unknown'))
            return roleResult('unknown', '', role + ' ambigu ou en chargement');
        if (ids.size === 1) return results.find(r => r.state === 'assigned');
        return roleResult('empty', '', role + ' explicitement vide');
    }

    function readRoleDetailed(root, role, clientOnly = false) {
        if (!root) return roleResult('unknown', '', role + ' conteneur absent');
        const isForeign = element => {
            if (!clientOnly) return false;
            return Boolean(element.closest('[id*="element_toggle_estimate_"], [data-estimate-id], ' +
                '[class*="estimate"], [id*="estimate"], .task, [class*="task"], [id*="task"]')) ||
                /estimate\[/.test(element.name || '');
        };
        const controls = Array.from(root.querySelectorAll('input[name], select[name], textarea[name], [data-' + role + '-user-id]'))
            .filter(el => {
                if (isForeign(el)) return false;
                const name = normalizeText(el.name || '');
                const strictMatch = new RegExp('(?:^|\\[|_)' + role + '(?:_user)?_id(?:\\]|$)').test(el.name || '');
                // Compatibilité avec les champs réellement utilisés par Modulr avant la 11.2.3 :
                // certains noms ne finissent pas exactement par *_user_id mais contiennent bien role + user.
                const legacyMatch = name.includes(role) && name.includes('user');
                return strictMatch || legacyMatch || el.hasAttribute('data-' + role + '-user-id');
            });
        if (controls.length) return mergeRoleResults(controls.map(el => readRoleControl(el, role)), role);
        const labels = Array.from(root.querySelectorAll('label, th, td, dt, p, li, span, strong, b, div'))
            .filter(el => !isForeign(el) && !el.closest('select, option, .task, [class*="task"], [id*="task"]') &&
                new RegExp('^' + role + '(?:\\s+(?:du devis|client))?\\s*(?::.*)?$').test(normalizeText(el.textContent)));
        const results = [];
        for (const label of labels) {
            const inline = normalizeText(label.textContent).match(new RegExp('^' + role + '(?:\\s+(?:du devis|client))?\\s*:\\s*(.+)$'));
            if (inline) {
                const inlineControl = label.querySelector('select, input');
                if (inlineControl) { results.push(readRoleControl(inlineControl, role)); continue; }
                // Do not treat a parent containing both roles as a role-value pair.
                if (/\\b(?:referent|binome)\\b/.test(inline[1])) continue;
                const id = identifyUserText(inline[1]);
                if (id) results.push(roleResult('assigned', id, role + ' valeur après libellé'));
                else if (/^(?:-|—|aucun(?:e)?|non renseigne)$/.test(inline[1]))
                    results.push(roleResult('empty', '', role + ' explicitement vide'));
                else results.push(roleResult('unknown', '', role + ' valeur ambiguë'));
                continue;
            }
            const linked = label.htmlFor && root.querySelector('#' + CSS.escape(label.htmlFor));
            if (linked) { results.push(readRoleControl(linked, role)); continue; }
            const value = label.nextElementSibling;
            if (!value || isForeign(value)) continue;
            const control = value.matches('select, input') ? value : value.querySelector('select, input');
            if (control) { results.push(readRoleControl(control, role)); continue; }
            const clone = value.cloneNode(true);
            clone.querySelectorAll('select, option, script, style, .task, [class*="task"]').forEach(el => el.remove());
            let text = clone.textContent || '';
            clone.querySelectorAll('[title], [aria-label], [data-original-title], [data-title]').forEach(el => {
                text += ' ' + (el.getAttribute('title') || el.getAttribute('aria-label') ||
                    el.getAttribute('data-original-title') || el.getAttribute('data-title') || '');
            });
            text += ' ' + (value.getAttribute('title') || value.getAttribute('aria-label') || '');
            const id = identifyUserText(text);
            if (id) results.push(roleResult('assigned', id, role + ' valeur liée au libellé'));
            else if (/^(?:-|—|aucun(?:e)?|non renseigne|sans referent|sans binome)\s*$/.test(normalizeText(text)))
                results.push(roleResult('empty', '', role + ' explicitement vide'));
            else results.push(roleResult('unknown', '', role + ' valeur ambiguë'));
        }
        return mergeRoleResults(results, role);
    }

    function extractUserIdNearRoleDetailed(root, rolePatterns, sourceLabel) {
        return readRoleDetailed(root, normalizeText(sourceLabel));
    }

    function extractUserIdFromElementDetailed(root) {
        return readRoleDetailed(root, 'referent');
    }

    function extractBinomeUserIdFromElementDetailed(root) {
        return readRoleDetailed(root, 'binome');
    }

    function getReferentUserIdFromEstimateRootDetailed(
        root,
        estimateId
    ) {
        const container =
            findEstimateContainerInRoot(
                root,
                estimateId
            );

        const result =
            extractUserIdFromElementDetailed(
                container
            );

        return {
            ...result,

            containerFound:
                Boolean(
                    container
                )
        };
    }

    function getBinomeUserIdFromEstimateRootDetailed(
        root,
        estimateId
    ) {
        const container =
            findEstimateContainerInRoot(
                root,
                estimateId
            );

        const result =
            extractBinomeUserIdFromElementDetailed(
                container
            );

        return {
            ...result,

            containerFound:
                Boolean(
                    container
                )
        };
    }

    async function fetchFreshPage(
        urlValue,
        signal
    ) {
        const response =
            await fetch(
                urlValue ||
                window.location.href,

                {
                    method:
                        'GET',

                    credentials:
                        'same-origin',

                    redirect:
                        'follow',

                    signal
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Impossible de recharger la fiche client : HTTP ${response.status}`
            );
        }

        const html =
            await response.text();

        return {
            html,

            doc:
                new DOMParser()
                    .parseFromString(
                        html,
                        'text/html'
                    ),

            finalUrl:
                response.url
                ||
                urlValue
                ||
                window.location.href
        };
    }

    function getFormDataWithSubmitter(
        form,
        submitter
    ) {
        const formData =
            new FormData(
                form
            );

        if (
            submitter &&
            submitter.name &&
            !submitter.disabled &&
            !formData.has(
                submitter.name
            )
        ) {
            formData.append(
                submitter.name,
                submitter.value || ''
            );
        }

        return formData;
    }

    function makeTaskSignature(
        data,
        estimateId
    ) {
        return [
            data.statusKey || '',
            data.clientId || '',
            estimateId || '',
            data.userId || '',
            new Date()
                .toISOString()
                .slice(
                    0,
                    10
                )
        ].join('|');
    }

    function cleanOldDoneKeys() {
        const now =
            Date.now();

        Object
            .keys(
                sessionStorage
            )
            .forEach(
                key => {
                    if (
                        !key.startsWith(
                            STORAGE_PREFIX
                        )
                    ) {
                        return;
                    }

                    const timestamp =
                        Number(
                            sessionStorage
                                .getItem(
                                    key
                                )
                        );

                    if (
                        !timestamp ||
                        now - timestamp >
                        DONE_DURATION_MS
                    ) {
                        sessionStorage
                            .removeItem(
                                key
                            );
                    }
                }
            );
    }

    async function createTask(
        data,
        estimateId
    ) {
        const config =
            CONFIG_ETATS[
                data.statusKey
            ];

        if (
            !config
        ) {
            throw new Error(
                `État non configuré : ${data.statusKey}`
            );
        }

        const cleanEstimateId =
            normalizeEstimateId(
                estimateId
            );

        if (
            !data.clientId ||
            !data.userId ||
            !cleanEstimateId
        ) {
            throw new Error(
                `Données insuffisantes : client=${data.clientId || 'vide'}, `
                +
                `devis=${cleanEstimateId || 'vide'}, utilisateur=${data.userId || 'vide'}`
            );
        }

        const signature =
            makeTaskSignature(
                data,
                cleanEstimateId
            );

        const storageKey =
            STORAGE_PREFIX
            +
            signature;

        if (
            sessionStorage
                .getItem(
                    storageKey
                )
        ) {
            warn(
                'Tâche déjà créée, aucune nouvelle requête envoyée :',
                signature
            );

            return {
                alreadyDone:
                    true,

                signature
            };
        }

        const body =
            new URLSearchParams();

        body.append(
            'action',
            'send'
        );

        body.append(
            'mode',
            'create'
        );

        body.append(
            'entity_id',
            data.clientId
        );

        body.append(
            'class_name',
            'Client'
        );

        body.append(
            'task_mode',
            'from_scratch'
        );

        body.append(
            'task[name]',
            config.titre
        );

        body.append(
            'task[recall_date]',
            formatDate(
                config.delai
            )
        );

        body.append(
            'task_actors_list_id',
            `user:${data.userId}`
        );

        body.append(
            'task[event_type]',
            '195'
        );

        body.append(
            'task[notes]',
            config.note
        );

        body.append(
            'task_related_to_entity',
            'EstimateData'
        );

        body.append(
            'selected_subentity_id',
            `EstimateData:${cleanEstimateId}`
        );

        section(
            'CRÉATION DE LA TÂCHE'
        );

        console.table({
            titre:
                config.titre,

            statusKey:
                data.statusKey,

            clientId:
                data.clientId,

            clientSource:
                data.clientSource
                ||
                '(non précisée)',

            estimateId:
                cleanEstimateId,

            estimateIdSource:
                data.estimateIdSource
                ||
                '(non précisée)',

            userId:
                data.userId,

            referentSource:
                data.referentSource
                ||
                '(non précisée)',

            taskActor:
                `user:${data.userId}`
        });

        const response =
            await fetch(
                'https://courtage.modulr.fr/fr/scripts/Tasks/TasksManage.php',

                {
                    method:
                        'POST',

                    credentials:
                        'same-origin',

                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded; charset=UTF-8',

                        'X-Requested-With':
                            'XMLHttpRequest'
                    },

                    body:
                        body.toString()
                }
            );

        if (
            !response.ok
        ) {
            throw new Error(
                `Erreur serveur création tâche : HTTP ${response.status}`
            );
        }

        sessionStorage
            .setItem(
                storageKey,
                String(
                    Date.now()
                )
            );

        log(
            '✅ Tâche créée avec succès :',
            {
                titre:
                    config.titre,

                clientId:
                    data.clientId,

                estimateId:
                    cleanEstimateId,

                userId:
                    data.userId,

                referentSource:
                    data.referentSource
                    ||
                    ''
            }
        );

        return {
            alreadyDone:
                false,

            signature
        };
    }

    async function runNativeFormSubmitByFetch(
        form,
        submitter
    ) {
        const method =
            (
                form.method
                ||
                'POST'
            )
                .toUpperCase();

        const actionUrl =
            new URL(
                form.getAttribute(
                    'action'
                )
                ||
                window.location.href,

                window.location.href
            );

        const formData =
            getFormDataWithSubmitter(
                form,
                submitter
            );

        let response;

        if (
            method === 'GET'
        ) {
            const params =
                new URLSearchParams();

            for (
                const [
                    key,
                    value
                ]
                of formData.entries()
            ) {
                if (
                    !(
                        value
                        instanceof File
                    )
                ) {
                    params.append(
                        key,
                        String(
                            value
                        )
                    );
                }
            }

            actionUrl.search =
                params.toString();

            response =
                await fetch(
                    actionUrl.href,

                    {
                        method:
                            'GET',

                        credentials:
                            'same-origin',

                        redirect:
                            'follow'
                    }
                );

        } else {
            response =
                await fetch(
                    actionUrl.href,

                    {
                        method:
                            'POST',

                        credentials:
                            'same-origin',

                        redirect:
                            'follow',

                        body:
                            formData
                    }
                );
        }

        if (
            !response.ok
        ) {
            throw new Error(
                `Erreur Modulr enregistrement devis : HTTP ${response.status}`
            );
        }

        const html =
            await response.text();

        return {
            html,

            finalUrl:
                response.url
                ||
                window.location.href,

            formData
        };
    }

    function submitFormNatively(
        form,
        submitter
    ) {
        if (
            submitter &&
            submitter.name
        ) {
            const hidden =
                document.createElement(
                    'input'
                );

            hidden.type =
                'hidden';

            hidden.name =
                submitter.name;

            hidden.value =
                submitter.value
                ||
                '';

            hidden.setAttribute(
                'data-modulr-auto-task-submit',
                '1'
            );

            form.appendChild(
                hidden
            );
        }

        HTMLFormElement
            .prototype
            .submit
            .call(
                form
            );
    }

    async function resolveNewEstimateContext({
        idsBefore,
        nativeResult,
        referentFromForm,
        form
    }) {
        section(
            'IDENTIFICATION DU NOUVEAU DEVIS'
        );

        const finalUrlEstimateId =
            getEstimateIdFromFinalUrl(
                nativeResult.finalUrl
            );

        const idsAfterResponse =
            collectEstimateIdsFromHtml(
                nativeResult.html
                ||
                ''
            );

        const newIds =
            Array
                .from(
                    idsAfterResponse
                )
                .filter(
                    id =>
                        !idsBefore.has(
                            id
                        )
                );

        console.table({
            finalUrl:
                nativeResult.finalUrl,

            finalUrlEstimateId:
                finalUrlEstimateId
                ||
                '(aucun)',

            idsAvant:
                Array
                    .from(
                        idsBefore
                    )
                    .join(
                        ', '
                    )
                ||
                '(aucun)',

            idsApresReponse:
                Array
                    .from(
                        idsAfterResponse
                    )
                    .join(
                        ', '
                    )
                ||
                '(aucun)',

            nouveauxIds:
                newIds.join(
                    ', '
                )
                ||
                '(aucun)'
        });

        let estimateId =
            idsBefore.has(finalUrlEstimateId) ? '' : finalUrlEstimateId;

        let estimateIdSource =
            estimateId
                ? 'paramètre open / ID explicite dans URL finale Modulr'
                : '';

        if (
            !estimateId &&
            newIds.length === 1
        ) {
            estimateId =
                newIds[0];

            estimateIdSource =
                'différence exacte IDs après - avant dans la réponse HTML';
        }

        if (
            !estimateId
        ) {
            throw new Error(
                'Impossible d’identifier de façon fiable le nouvel ID du devis.'
            );
        }

        log(
            `✅ Nouveau devis identifié : ${estimateId} (${estimateIdSource})`
        );

        const responseDoc = new DOMParser().parseFromString(nativeResult.html || '', 'text/html');
        const referent = await resolveEstimateAssignment({
            estimateId,
            pageUrl: nativeResult.finalUrl,
            responseDoc,
            form
        });

        return {
            estimateId,

            estimateIdSource,

            userId:
                referent.userId,

            referentSource:
                referent.source
        };
    }

    function getEstimateIdFromStatusLinkDetailed(
        link
    ) {
        const url =
            new URL(
                link.href,
                window.location.origin
            );

        const candidates = [
            {
                source:
                    'URL changement état / estimate_id',

                value:
                    url.searchParams
                        .get(
                            'estimate_id'
                        )
            },

            {
                source:
                    'URL changement état / id_estimate',

                value:
                    url.searchParams
                        .get(
                            'id_estimate'
                        )
            }
        ];

        const linkOpen =
            url.searchParams
                .get(
                    'open'
                );

        const linkOpenMatch =
            String(
                linkOpen || ''
            )
                .match(
                    /^element_toggle_estimate_(\d+)$/i
                );

        if (
            linkOpenMatch
        ) {
            candidates.push({
                source:
                    'paramètre open du lien',

                value:
                    linkOpenMatch[1]
            });
        }

        let node =
            link;

        let depth =
            0;

        while (
            node &&
            node !== document.body &&
            depth < 15
        ) {
            const ownMatch =
                String(
                    node.id || ''
                )
                    .match(
                        /element_toggle_estimate_(\d+)/i
                    );

            if (
                ownMatch
            ) {
                candidates.push({
                    source:
                        `ID conteneur parent niveau ${depth}`,

                    value:
                        ownMatch[1]
                });
            }

            const hiddenOrLink =
                node.querySelector?.(
                    '[id*="element_toggle_estimate_"], a[href*="estimate_id="], a[href*="id_estimate="], [value^="EstimateData:"]'
                );

            if (
                hiddenOrLink
            ) {
                const idMatch =
                    String(
                        hiddenOrLink.id || ''
                    )
                        .match(
                            /element_toggle_estimate_(\d+)/i
                        );

                if (
                    idMatch
                ) {
                    candidates.push({
                        source:
                            `élément devis dans contexte niveau ${depth}`,

                        value:
                            idMatch[1]
                    });
                }

                const valueMatch =
                    String(
                        hiddenOrLink.value || ''
                    )
                        .match(
                            /^EstimateData:(\d+)$/i
                        );

                if (
                    valueMatch
                ) {
                    candidates.push({
                        source:
                            `EstimateData dans contexte niveau ${depth}`,

                        value:
                            valueMatch[1]
                    });
                }

                if (
                    hiddenOrLink.href
                ) {
                    candidates.push(
                        {
                            source:
                                `lien contexte niveau ${depth} / estimate_id`,

                            value:
                                getParamFromUrl(
                                    hiddenOrLink.href,
                                    'estimate_id'
                                )
                        },

                        {
                            source:
                                `lien contexte niveau ${depth} / id_estimate`,

                            value:
                                getParamFromUrl(
                                    hiddenOrLink.href,
                                    'id_estimate'
                                )
                        }
                    );
                }
            }

            node =
                node.parentElement;

            depth++;
        }

        const currentOpen =
            getParamFromUrl(
                window.location.href,
                'open'
            );

        const currentOpenMatch =
            String(
                currentOpen || ''
            )
                .match(
                    /^element_toggle_estimate_(\d+)$/i
                );

        if (
            currentOpenMatch
        ) {
            candidates.push({
                source:
                    'paramètre open de l’URL actuelle',

                value:
                    currentOpenMatch[1]
            });
        }

        candidates.push(
            {
                source:
                    'URL actuelle / estimate_id',

                value:
                    getParamFromUrl(
                        window.location.href,
                        'estimate_id'
                    )
            },

            {
                source:
                    'URL actuelle / id_estimate',

                value:
                    getParamFromUrl(
                        window.location.href,
                        'id_estimate'
                    )
            }
        );

        section(
            'IDENTIFICATION DU DEVIS EXISTANT'
        );

        console.table(
            candidates.map(
                candidate => ({
                    source:
                        candidate.source,

                    valeur:
                        candidate.value || '',

                    valide:
                        Boolean(
                            normalizeEstimateId(
                                candidate.value
                            )
                        )
                })
            )
        );

        for (
            const candidate
            of candidates
        ) {
            const estimateId =
                normalizeEstimateId(
                    candidate.value
                );

            if (
                estimateId
            ) {
                log(
                    `✅ Devis existant identifié : ${estimateId} (${candidate.source})`
                );

                return {
                    estimateId,

                    source:
                        candidate.source
                };
            }
        }

        return {
            estimateId: '',
            source: 'introuvable'
        };
    }

    function readAssignmentSnapshot(root, estimateId, form = null) {
        const container = findEstimateContainerInRoot(root, estimateId);
        function read(role) {
            const formResult = form && readRoleDetailed(form, role);
            // A present form control has priority, including empty / loading values.
            if (formResult && (formResult.state !== 'unknown' ||
                formResult.source !== role + ' non lisible')) return formResult;
            const estimateResult = readRoleDetailed(container, role);
            if (estimateResult.state !== 'unknown' || (container &&
                estimateResult.source !== role + ' non lisible')) return estimateResult;
            // Only dedicated client fields / role-value pairs, never arbitrary page text.
            return readRoleDetailed(root, role, true);
        }
        return { referent: read('referent'), binome: read('binome') };
    }

    function chooseAssignment(snapshot, allowConnected = false) {
        const { referent, binome } = snapshot;
        if (referent.state === 'assigned') return referent;
        if (referent.state !== 'empty') return null;
        if (binome.state === 'assigned') return { ...binome, source: 'fallback binôme → ' + binome.source };
        if (binome.state !== 'empty' || !allowConnected) return null;
        const active = getActiveUserInfo();
        if (!active.userId) throw new Error('Utilisateur connecté non identifiable.');
        return { ...active, source: 'Référent et binôme explicitement vides → ' + active.source };
    }

    async function resolveEstimateAssignment({ estimateId, form = null,
        pageUrl = window.location.href, responseDoc = null, timeoutMs = 6000 }) {
        const deadline = Date.now() + timeoutMs;
        let freshDoc = responseDoc;
        let snapshot;

        async function refresh() {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(3000, deadline - Date.now())));
            try { return (await fetchFreshPage(pageUrl, controller.signal)).doc; }
            finally { clearTimeout(timer); }
        }

        // 11.2.6 : retour au comportement qui fonctionnait en 11.2.2.
        // On cherche d'abord une valeur réellement sélectionnée dans le formulaire / devis,
        // puis dans une fiche fraîche. On ne bloque plus 6 s uniquement parce qu'un autre
        // rôle est "unknown" alors que le référent sélectionné est déjà lisible.
        while (Date.now() < deadline) {
            snapshot = readAssignmentSnapshot(document, estimateId, form);

            if (snapshot.referent.state === 'assigned') {
                log('Référent trouvé directement :', snapshot.referent);
                return snapshot.referent;
            }

            // Si le référent est explicitement vide, le binôme peut être utilisé immédiatement.
            if (snapshot.referent.state === 'empty' && snapshot.binome.state === 'assigned') {
                const chosen = { ...snapshot.binome, source: 'fallback binôme → ' + snapshot.binome.source };
                log('Référent vide, binôme trouvé :', chosen);
                return chosen;
            }

            if (!freshDoc) {
                try { freshDoc = await refresh(); }
                catch (err) { warn('Vérification ciblée de la fiche indisponible :', err); }
            }

            if (freshDoc) {
                const fresh = readAssignmentSnapshot(freshDoc, estimateId);

                if (fresh.referent.state === 'assigned') {
                    return { ...fresh.referent, source: 'vérification ciblée → ' + fresh.referent.source };
                }

                if (fresh.referent.state === 'empty' && fresh.binome.state === 'assigned') {
                    return { ...fresh.binome, source: 'fallback binôme après vérification ciblée → ' + fresh.binome.source };
                }

                // Les 2 rôles ne doivent tomber sur l'utilisateur connecté que lorsqu'ils sont
                // explicitement vides dans une source fiable.
                if (fresh.referent.state === 'empty' && fresh.binome.state === 'empty') {
                    return chooseAssignment(fresh, true);
                }
            }

            // Même règle pour le formulaire live : fallback connecté seulement si les 2 sont vides.
            if (snapshot.referent.state === 'empty' && snapshot.binome.state === 'empty') {
                return chooseAssignment(snapshot, true);
            }

            await new Promise(resolve => setTimeout(resolve, 150));
            freshDoc = null;
        }

        console.table(snapshot);
        throw new Error('Référent ou binôme non lisible par le script malgré les données affichées dans Modulr.');
    }

    async function resolveExistingEstimateReferent(link, estimateId, clientId = '') {
        // Sur la fiche client, les détails du devis sont chargés en AJAX.
        // Le HTML initial ne contient donc ni Référent ni Binôme.
        // On tente d'abord le DOM live, puis on lit directement la page de modification du devis.
        try {
            return await resolveEstimateAssignment({ estimateId, timeoutMs: 1200 });
        } catch (liveError) {
            warn('Assignation absente du HTML initial / détails AJAX non chargés :', liveError);
        }

        const editUrl = new URL('/fr/scripts/estimates/estimates_manage.php', window.location.origin);
        if (clientId) editUrl.searchParams.set('client_id', clientId);
        editUrl.searchParams.set('estimate_id', estimateId);

        const freshEdit = await fetchFreshPage(editUrl.href);
        const editForm =
            freshEdit.doc.querySelector('form[action*="estimates"], form') ||
            null;

        // La page de modification est la source fiable : elle contient les valeurs enregistrées.
        const snapshot = readAssignmentSnapshot(freshEdit.doc, estimateId, editForm);
        const chosen = chooseAssignment(snapshot);

        if (chosen) {
            return { ...chosen, source: 'page modification devis → ' + chosen.source };
        }

        if (snapshot.referent.state === 'empty' && snapshot.binome.state === 'empty') {
            return chooseAssignment(snapshot, true);
        }

        console.table(snapshot);
        throw new Error(
            'Référent/binôme absents du HTML initial et non lisibles sur la page de modification du devis.'
        );
    }

    async function handleEstimateStatusUpdate(
        link,
        event
    ) {
        if (
            event.defaultPrevented
        ) {
            return;
        }

        if (
            event.button !== undefined &&
            event.button !== 0
        ) {
            return;
        }

        if (
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        const url =
            new URL(
                link.href,
                window.location.origin
            );

        const statusKey =
            url.searchParams
                .get(
                    'status_key'
                );

        if (
            !CONFIG_ETATS[
                statusKey
            ]
        ) {
            return;
        }

        event.preventDefault();

        event
            .stopImmediatePropagation();

        if (
            isProcessing
        ) {
            return;
        }

        isProcessing =
            true;

        section(
            'CHANGEMENT D’ÉTAT D’UN DEVIS EXISTANT'
        );

        try {
            const estimateInfo =
                getEstimateIdFromStatusLinkDetailed(
                    link
                );

            if (
                !estimateInfo.estimateId
            ) {
                throw new Error(
                    'Impossible d’identifier précisément le devis concerné par le changement d’état.'
                );
            }

            const estimateId =
                estimateInfo.estimateId;

            const estimateContainer =
                findEstimateContainerInRoot(
                    document,
                    estimateId
                );

            let clientId =
                '';

            let clientSource =
                '';

            const clientField =
                estimateContainer
                    ?.querySelector(
                        '[name="estimate[client_id]"], [name="client_id"]'
                    );

            if (
                clientField &&
                clientField.value
            ) {
                clientId =
                    String(
                        clientField.value
                    );

                clientSource =
                    'conteneur exact du devis';
            }

            if (
                !clientId
            ) {
                clientId =
                    getVisibleClientTaskButtonId(
                        document
                    );

                if (
                    clientId
                ) {
                    clientSource =
                        'bouton tâche visible de la fiche client';
                }
            }

            if (
                !clientId
            ) {
                clientId =
                    url.searchParams
                        .get(
                            'client_id'
                        )

                    ||

                    url.searchParams
                        .get(
                            'entity_id'
                        )

                    ||

                    '';

                if (
                    clientId
                ) {
                    clientSource =
                        'URL du changement d’état';
                }
            }

            if (
                !clientId
            ) {
                clientId =
                    getClientIdFromUrl(
                        window.location.href
                    );

                if (
                    clientId
                ) {
                    clientSource =
                        'URL actuelle de la fiche client';
                }
            }

            if (
                !clientId
            ) {
                throw new Error(
                    `Impossible d’identifier le client du devis ${estimateId}.`
                );
            }

            log(
                `✅ Client identifié : ${clientId} (${clientSource})`
            );

            const referent =
                await resolveExistingEstimateReferent(
                    link,
                    estimateId,
                    clientId
                );

            if (
                !referent.userId
            ) {
                throw new Error(
                    `Impossible d’identifier un utilisateur pour le devis ${estimateId}.`
                );
            }

            section(
                'CONTEXTE FINAL DU CHANGEMENT D’ÉTAT'
            );

            console.table({
                statusKey,

                clientId,

                clientSource,

                estimateId,

                estimateIdSource:
                    estimateInfo.source,

                userId:
                    referent.userId,

                referentSource:
                    referent.source,

                nouvelleTache:
                    CONFIG_ETATS[
                        statusKey
                    ].titre
            });

            await createTask(
                {
                    statusKey,

                    clientId,

                    clientSource,

                    userId:
                        referent.userId,

                    referentSource:
                        referent.source,

                    estimateIdSource:
                        estimateInfo.source
                },

                estimateId
            );

            log(
                `✅ Tâche créée. Lancement maintenant du changement d’état du devis ${estimateId}.`
            );

            window.location.href =
                link.href;

        } catch (
            err
        ) {
            error(
                'Erreur changement d’état du devis :',
                err
            );

            isProcessing =
                false;

            const reason = err instanceof Error ? err.message : String(err);
            alert(
                "La tâche automatique n'a pas pu être créée correctement.\n\n"
                +
                "Cause : " + reason + "\n\n"
                +
                "Le changement d'état n'a pas été lancé afin d'éviter une incohérence."
            );
        }
    }

    async function handleEstimateFormSubmit(
        form,
        submitter,
        event
    ) {
        if (
            !form
        ) {
            return;
        }

        const statusKey =
            getStatusKeyFromForm(
                form
            );

        if (
            !CONFIG_ETATS[
                statusKey
            ]
        ) {
            return;
        }

        event.preventDefault();

        event
            .stopImmediatePropagation();

        if (
            isProcessing
        ) {
            return;
        }

        isProcessing =
            true;

        if (
            event.type === 'click'
            &&
            typeof form.reportValidity ===
                'function'
            &&
            !form.reportValidity()
        ) {
            isProcessing =
                false;

            return;
        }

        const initialEstimateId =
            getEstimateIdFromForm(
                form
            );

        const clientInfo =
            getClientIdFromFormDetailed(
                form
            );

        const referentFromForm =
            getReferentUserIdFromFormDetailed(
                form
            );

        section(
            initialEstimateId
                ? 'MODIFICATION D’UN DEVIS EXISTANT'
                : 'CRÉATION D’UN NOUVEAU DEVIS'
        );

        console.table({
            statusKey,

            clientId:
                clientInfo.clientId
                ||
                '(introuvable)',

            clientSource:
                clientInfo.source,

            initialEstimateId:
                initialEstimateId
                ||
                '(nouveau devis)',

            referentFormUserId:
                referentFromForm.userId
                ||
                '(introuvable)',

            referentFormSource:
                referentFromForm.source
        });

        let stage = 'lecture du client';
        let saveAttempted = false;
        let taskAttempted = false;
        try {
            if (
                !clientInfo.clientId
            ) {
                throw new Error(
                    'Client ID introuvable.'
                );
            }

            if (
                initialEstimateId
            ) {
                stage = 'lecture du référent et du binôme';
                const referent = await resolveEstimateAssignment({
                    estimateId: initialEstimateId,
                    form
                });

                stage = 'création de la tâche';
                taskAttempted = true;
                await createTask(
                    {
                        statusKey,

                        clientId:
                            clientInfo.clientId,

                        clientSource:
                            clientInfo.source,

                        userId:
                            referent.userId,

                        referentSource:
                            referent.source,

                        estimateIdSource:
                            'ID déjà présent dans le formulaire ou son contexte'
                    },

                    initialEstimateId
                );

                stage = 'enregistrement du devis';
                saveAttempted = true;
                submitFormNatively(
                    form,
                    submitter
                );

                return;
            }

            // Nouveau devis : le formulaire Modulr expose directement
            // estimate[referent_user_id], mais aucun champ binôme.
            // Ne jamais bloquer l'enregistrement en attendant un binôme qui n'existe pas ici.
            stage = 'lecture du référent avant enregistrement';
            let newEstimateAssignee = referentFromForm;

            if (!newEstimateAssignee.userId) {
                const activeUser = getActiveUserInfo();
                if (activeUser.userId) {
                    newEstimateAssignee = {
                        userId: activeUser.userId,
                        source: 'nouveau devis sans référent sélectionné → utilisateur connecté'
                    };
                }
            }

            const idsBefore =
                collectEstimateIdsFromRoot(
                    document
                );

            section(
                'SNAPSHOT AVANT CRÉATION'
            );

            log(
                'IDs devis présents avant création :',
                Array.from(
                    idsBefore
                )
            );

            section(
                'ENREGISTREMENT DU DEVIS PAR MODULR'
            );

            log(
                '➡️ Envoi du formulaire de devis...',
                {
                    action:
                        form.action
                        ||
                        '',

                    method:
                        form.method
                        ||
                        '',

                    clientId:
                        clientInfo.clientId,

                    statusKey,

                    referentUserId:
                        referentFromForm.userId
                        ||
                        '(introuvable)'
                }
            );

            stage = 'enregistrement du nouveau devis';
            saveAttempted = true;
            const nativeResult =
                await runNativeFormSubmitByFetch(
                    form,
                    submitter
                );

            log(
                '✅ Réponse reçue après enregistrement du devis.',
                {
                    finalUrl:
                        nativeResult.finalUrl,

                    htmlLength:
                        nativeResult.html
                            ?.length
                        ||
                        0
                }
            );

            stage = 'identification du devis enregistré et confirmation du responsable';
            const context =
                await resolveNewEstimateContext({
                    idsBefore,

                    nativeResult,

                    referentFromForm: newEstimateAssignee,
                    form
                });

            stage = 'création de la tâche';
            taskAttempted = true;
            await createTask(
                {
                    statusKey,

                    clientId:
                        clientInfo.clientId,

                    clientSource:
                        clientInfo.source,

                    userId:
                        context.userId,

                    referentSource:
                        context.referentSource,

                    estimateIdSource:
                        context.estimateIdSource
                },

                context.estimateId
            );

            window.location.href =
                nativeResult.finalUrl;

        } catch (
            err
        ) {
            error(
                'Erreur enregistrement devis :',
                err
            );

            isProcessing =
                false;

            const reason = err instanceof Error ? err.message : String(err);
            error('Diagnostic formulaire :', { version: VERSION, stage,
                saveAttempted, taskAttempted, estimateId: initialEstimateId || 'nouveau', reason });
            // 11.2.8 : fail-open. L'automatisation ne doit jamais empêcher
            // l'utilisateur d'enregistrer ou modifier un devis dans Modulr.
            if (!saveAttempted) {
                warn('Automatisation en échec avant sauvegarde : poursuite de l’enregistrement natif Modulr.');
                try {
                    submitFormNatively(form, submitter);
                    return;
                } catch (nativeErr) {
                    error('Échec du fallback natif Modulr :', nativeErr);
                }
            }

            alert(`Automatisation de tâche en échec à l’étape : ${stage}.\n\n${reason}\n\n` +
                'Le devis reste prioritaire : vérifiez simplement si la tâche a bien été créée.');
        }
    }

    document.addEventListener(
        'click',

        function (
            event
        ) {
            const link =
                event.target
                    .closest(
                        'a'
                    );

            if (
                link
                &&
                link.href
                &&
                link.href.includes(
                    'estimates_update.php'
                )
            ) {
                handleEstimateStatusUpdate(
                    link,
                    event
                );

                return;
            }

            const submitButton =
                event.target
                    .closest(
                        'button[type="submit"], input[type="submit"]'
                    );

            if (
                submitButton
                &&
                submitButton.form
            ) {
                lastSubmitter =
                    submitButton;

                const statusKey =
                    getStatusKeyFromForm(
                        submitButton.form
                    );

                if (
                    CONFIG_ETATS[
                        statusKey
                    ]
                ) {
                    handleEstimateFormSubmit(
                        submitButton.form,
                        submitButton,
                        event
                    );
                }
            }
        },

        true
    );

    document.addEventListener(
        'submit',

        function (
            event
        ) {
            const form =
                event.target;

            if (
                !form
            ) {
                return;
            }

            handleEstimateFormSubmit(
                form,

                lastSubmitter
                ||
                event.submitter
                ||
                null,

                event
            );
        },

        true
    );

    window.addEventListener(
        'load',
        cleanOldDoneKeys
    );

})();
