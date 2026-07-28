// ==UserScript==
// @name         Creation Tâche Automatique Changement Etat Devis
// @namespace    https://github.com/BiggerThanTheMall
// @version      11.2.1
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

    const VERSION = '11.2.1';
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
        { id: '28', patterns: ['jcasimir', 'casimir'] },
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

    function getReferentUserIdFromFormDetailed(
        form
    ) {
        const selectors = [
            '[name="estimate[referent_user_id]"]',
            '[name="referent_user_id"]',
            '[name*="referent_user_id"]',
            '[name*="referent"][name*="user"]'
        ];

        for (
            const selector
            of selectors
        ) {
            for (
                const field
                of form.querySelectorAll(
                    selector
                )
            ) {
                const userId =
                    normalizeUserId(
                        field.value
                    );

                if (
                    userId
                ) {
                    return {
                        userId,

                        source:
                            `formulaire ${selector}`,

                        rawValue:
                            field.value
                    };
                }
            }
        }

        return {
            userId: '',

            source:
                'introuvable dans le formulaire',

            rawValue: ''
        };
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
                '[id*="element_toggle_estimate_"]'
            )
            .forEach(
                el => {
                    const match =
                        String(
                            el.id || ''
                        )
                            .match(
                                /element_toggle_estimate_(\d+)/i
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
            /element_toggle_estimate_(\d+)/gi,
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
                    /^element_toggle_estimate_(\d+)$/i
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
            `#element_toggle_estimate_${CSS.escape(id)}`,

            `[data-estimate-id="${CSS.escape(id)}"]`,

            `a[href*="estimate_id=${encodeURIComponent(id)}"]`,

            `a[href*="id_estimate=${encodeURIComponent(id)}"]`,

            `[value="EstimateData:${CSS.escape(id)}"]`
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

    function findEstimateContainerInRoot(
        root,
        estimateId
    ) {
        const anchor =
            findEstimateAnchorInRoot(
                root,
                estimateId
            );

        if (
            !anchor
        ) {
            return null;
        }

        let node =
            anchor;

        let depth =
            0;

        while (
            node &&
            depth < 12
        ) {
            const text =
                normalizeText(
                    node.textContent || ''
                );

            const hasReferentField =
                Boolean(
                    node.querySelector?.(
                        '[name="estimate[referent_user_id]"], [name="referent_user_id"], [name*="referent_user_id"]'
                    )
                );

            if (
                hasReferentField ||
                text.includes(
                    'referent'
                )
            ) {
                return node;
            }

            node =
                node.parentElement;

            depth++;
        }

        return (
            anchor.closest(
                'tr, li, .card, .panel, .box, .well, [class*="estimate"], [id*="estimate"], [class*="devis"], [id*="devis"]'
            )

            ||

            anchor.parentElement

            ||

            anchor
        );
    }

    function extractUserIdFromElementDetailed(
        root
    ) {
        if (
            !root
        ) {
            return {
                userId: '',
                source: 'conteneur absent'
            };
        }

        const fieldSelectors = [
            '[name="estimate[referent_user_id]"]',
            '[name="referent_user_id"]',
            '[name*="referent_user_id"]',
            '[name*="referent"][name*="user"]',
            '[data-referent-user-id]'
        ];

        for (
            const selector
            of fieldSelectors
        ) {
            for (
                const element
                of root.querySelectorAll(
                    selector
                )
            ) {
                const values = [
                    element.value,

                    element.getAttribute(
                        'data-referent-user-id'
                    )
                ];

                for (
                    const value
                    of values
                ) {
                    const userId =
                        normalizeUserId(
                            value
                        );

                    if (
                        userId
                    ) {
                        return {
                            userId,

                            source:
                                `conteneur devis ${selector}`
                        };
                    }
                }
            }
        }

        let text =
            normalizeText(
                root.textContent || ''
            );

        root
            .querySelectorAll(
                '[title], [aria-label], [data-original-title], [data-title]'
            )
            .forEach(
                el => {
                    text +=
                        ' '
                        +
                        normalizeText(
                            el.getAttribute(
                                'title'
                            )

                            ||

                            el.getAttribute(
                                'aria-label'
                            )

                            ||

                            el.getAttribute(
                                'data-original-title'
                            )

                            ||

                            el.getAttribute(
                                'data-title'
                            )

                            ||

                            ''
                        );
                }
            );

        for (
            const user
            of USER_TEXT_MAPPING
        ) {
            for (
                const pattern
                of user.patterns
            ) {
                if (
                    text.includes(
                        normalizeText(
                            pattern
                        )
                    )
                ) {
                    return {
                        userId:
                            user.id,

                        source:
                            `texte du conteneur devis (${pattern})`
                    };
                }
            }
        }

        return {
            userId: '',

            source:
                'introuvable dans le conteneur du devis'
        };
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

    async function fetchFreshPage(
        urlValue
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
                        'follow'
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
        referentFromForm
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
            finalUrlEstimateId;

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

        let referent =
            referentFromForm;

        if (
            referent.userId
        ) {
            log(
                `✅ Référent déjà trouvé dans le formulaire : user:${referent.userId} (${referent.source})`
            );

        } else {
            const responseDoc =
                new DOMParser()
                    .parseFromString(
                        nativeResult.html
                        ||
                        '',

                        'text/html'
                    );

            referent =
                getReferentUserIdFromEstimateRootDetailed(
                    responseDoc,
                    estimateId
                );
        }

        if (
            !referent.userId
        ) {
            warn(
                '⚠️ Référent absent de la réponse. Vérification ciblée de la fiche client.'
            );

            const freshPage =
                await fetchFreshPage(
                    nativeResult.finalUrl
                );

            referent =
                getReferentUserIdFromEstimateRootDetailed(
                    freshPage.doc,
                    estimateId
                );
        }

        if (
            !referent.userId
        ) {
            const activeUser =
                getActiveUserInfo();

            if (
                !activeUser.userId
            ) {
                throw new Error(
                    'Référent introuvable et utilisateur connecté non identifiable.'
                );
            }

            referent =
                activeUser;

            warn(
                `⚠️ Fallback final vers l’utilisateur connecté : ${activeUser.displayName} (user:${activeUser.userId}).`
            );
        }

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

    async function resolveExistingEstimateReferent(
        link,
        estimateId
    ) {
        section(
            'RECHERCHE DU RÉFÉRENT DU DEVIS EXISTANT'
        );

        const url =
            new URL(
                link.href,
                window.location.origin
            );

        const urlCandidates = [
            {
                source:
                    'URL / referent_user_id',

                value:
                    url.searchParams
                        .get(
                            'referent_user_id'
                        )
            },

            {
                source:
                    'URL / referent_id',

                value:
                    url.searchParams
                        .get(
                            'referent_id'
                        )
            },

            {
                source:
                    'URL / user_id',

                value:
                    url.searchParams
                        .get(
                            'user_id'
                        )
            }
        ];

        for (
            const candidate
            of urlCandidates
        ) {
            const userId =
                normalizeUserId(
                    candidate.value
                );

            if (
                userId
            ) {
                log(
                    `✅ Référent trouvé directement : user:${userId} (${candidate.source})`
                );

                return {
                    userId,

                    source:
                        candidate.source
                };
            }
        }

        const directResult =
            getReferentUserIdFromEstimateRootDetailed(
                document,
                estimateId
            );

        if (
            directResult.userId
        ) {
            log(
                `✅ Référent trouvé dans le devis ${estimateId} : user:${directResult.userId} (${directResult.source})`
            );

            return directResult;
        }

        warn(
            `⚠️ Référent non trouvé immédiatement pour le devis ${estimateId}. Vérification ciblée de la fiche client.`
        );

        try {
            const freshPage =
                await fetchFreshPage(
                    window.location.href
                );

            const freshResult =
                getReferentUserIdFromEstimateRootDetailed(
                    freshPage.doc,
                    estimateId
                );

            if (
                freshResult.userId
            ) {
                log(
                    `✅ Référent trouvé après vérification ciblée : user:${freshResult.userId} (${freshResult.source})`
                );

                return {
                    userId:
                        freshResult.userId,

                    source:
                        `vérification ciblée → ${freshResult.source}`
                };
            }

        } catch (
            err
        ) {
            warn(
                '⚠️ Vérification ciblée du référent impossible :',
                err
            );
        }

        const activeUser =
            getActiveUserInfo();

        if (
            !activeUser.userId
        ) {
            throw new Error(
                `Référent du devis ${estimateId} introuvable et utilisateur connecté non identifiable.`
            );
        }

        warn(
            `⚠️ Référent réellement introuvable. Fallback final vers ${activeUser.displayName} (user:${activeUser.userId}).`
        );

        return activeUser;
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
                    estimateId
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

            alert(
                "La tâche automatique n'a pas pu être créée correctement.\n\n"
                +
                "Le changement d'état n'a pas été lancé afin d'éviter une incohérence.\n\n"
                +
                'Merci de vérifier dans Modulr avant de refaire l’action.'
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
                let referent =
                    referentFromForm;

                if (
                    !referent.userId
                ) {
                    referent =
                        getReferentUserIdFromEstimateRootDetailed(
                            document,
                            initialEstimateId
                        );
                }

                if (
                    !referent.userId
                ) {
                    const activeUser =
                        getActiveUserInfo();

                    if (
                        !activeUser.userId
                    ) {
                        throw new Error(
                            'Référent du devis existant introuvable et utilisateur connecté non identifiable.'
                        );
                    }

                    referent =
                        activeUser;
                }

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

                submitFormNatively(
                    form,
                    submitter
                );

                return;
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

            const context =
                await resolveNewEstimateContext({
                    idsBefore,

                    nativeResult,

                    referentFromForm
                });

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

            alert(
                "L'enregistrement du devis ou la création de la tâche automatique n'a pas pu être confirmé.\n\n"
                +
                'Merci de vérifier dans Modulr avant de refaire l’action, afin d’éviter une double tâche.'
            );
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
