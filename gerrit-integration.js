/*
Copyright (c) 2014 Jan Chęć

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

var GerritMine = GerritMine || {};

GerritMine.getParameters = function() {
    // Source: http://feather.elektrum.org/book/src.html
    var scripts = document.getElementsByTagName('script');
    var currentlyRunningIndex = scripts.length - 1;
    var thisScriptNode = scripts[currentlyRunningIndex];
    var queryString = thisScriptNode.src.replace(/^[^\?]+\??/,'');
    return $.deparam(queryString);
};

GerritMine.parameters = GerritMine.getParameters();

$(function() {
    var GERRIT_SERVER = GerritMine.parameters.gerrit_server;
    var STORAGE_KEY = 'gerrit_integration';
    var SECOND = 1000;
    var UPDATE_AFTER = GerritMine.parameters.update_interval || 10 * SECOND;
    var EMPTY_RESPONSE_CONTENT_LENGTH = 8;
    var LINK_GERRIT_LOGIN_ON_ZERO_CHANGES = true;
    var JENKINS_USERNAME = 'Jenkins';
    var DEFAULT_LANGUAGE = 'EN';
    var TRANSLATIONS = {
        PL: {
            commentLink: "Skomentuj",
            needsLoginLink: "Zaloguj się do Gerrita, aby wyświetlały się statusy otwartych zmian przy zagadnieniach.",
            openChangesTitle: "Otwarte zmiany",
            hideTrivialMessagesTooltip: "Ukryj trywialne wiadomości.",
            showTrivialMessagesTooltip: "Pokaż trywialne wiadomości."
        },
        EN: {
            commentLink: "Comment",
            needsLoginLink: "Log in to Gerrit to see open changes statuses by issues.",
            openChangesTitle: "Open changes",
            hideTrivialMessagesTooltip: "Hide trivial messages.",
            showTrivialMessagesTooltip: "Show trivial messages."
        }
    };
    var STATUS_COLORS = {
        toFix: 'red',
        toMerge: 'green',
        'default': 'blue'
    };

    if(isBacklogPagePresent()) {
        if(needsUpdate()) {
            updateChanges(showChangesInformationOnBacklog);
        } else {
            showChangesInformationOnBacklog();
        }
    } else if(isIssueDetailsPagePresent()) {
        if(needsUpdate()) {
            updateChanges(showChangesForCurrentIssue);
        } else {
            showChangesForCurrentIssue();
        }
    } else if(isIssueListPagePresent()) {
        if(needsUpdate()) {
            updateChanges(showChangesInformationOnIssueList);
        } else {
            showChangesInformationOnIssueList();
        }
    }

    function isBacklogPagePresent() {
        return $('body').hasClass('controller-rb_master_backlogs');
    }

    function showChangesInformationOnBacklog() {
        var rowSelector = '#stories-for-product-backlog li';
        function getIssueNumber(row) {
            return row.find('.id.story_field div.t a').text();
        }
        function getStatusNode(row) {
            return row.find('.status_id.story_field div.t');
        }
        widenStatusColumn();
        _showChangesInformationOnIssueList(rowSelector, getIssueNumber, getStatusNode);

        function widenStatusColumn() {
            $('.status_id.editable.story_field').css({
                'padding-left': 0,
                'width': '76px'
            });
        }
    }

    function isIssueDetailsPagePresent() {
        return $('body').hasClass('action-show');
    }

    function needsUpdate() {
        try {
            var data = getData();
        } catch(error) {
            return error == 'No data yet.';
        }
        var now = new Date();
        var lastUpdated = new Date(data.updated);
        return UPDATE_AFTER < now - lastUpdated;
    }

    function updateChanges(success) {
        $.ajax({
            url: GERRIT_SERVER + '/changes/?q=is:open&o=LABELS&o=MESSAGES&o=CURRENT_REVISION',
            success: function(responseContent) {
                if(hasData(responseContent)) {
                    save(responseContent);
                    success();
                } else {
                    if(LINK_GERRIT_LOGIN_ON_ZERO_CHANGES)
                        informAboutEmptyResponse();
                }
            },
            xhrFields: {
                withCredentials: true
            },
            dataType: 'text'
        });

        function hasData(responseContent) {
            return responseContent.length > EMPTY_RESPONSE_CONTENT_LENGTH;
        }

        function save(data) {
            var changes = extractChanges(data);
            var toSave = mapIssesToChanges(changes);
            saveData(toSave);
        }

        function extractChanges(data) {
            var dataWithoutXSSIProtection = data.substring(5);
            return $.parseJSON(dataWithoutXSSIProtection);
        }

        function mapIssesToChanges(changes) {
            var map = {};
            for(var i = 0; i < changes.length; i++) {
                var issueNumber = getIssueNumber(changes[i].subject);
                if(issueNumber != undefined) {
                    if(map[issueNumber] == undefined)
                        map[issueNumber] = [];
                    map[issueNumber].push(changes[i]);
                }
            }
            return map;
        }

        function getIssueNumber(subject) {
            var issueNumberPattern = new RegExp('#[\\d]+');
            var matchSingleton = issueNumberPattern.exec(subject);
            if(matchSingleton)
                return matchSingleton[0].substring(1);
            else
                return undefined;
        }

        function informAboutEmptyResponse() {
            var info = $('<li><a href="' + GERRIT_SERVER + '" style="color: #ED8F64;"></a></li>');
            info.find('a').text(getText('needsLoginLink'));
            $('#top-menu>ul').append(info);
        }
    }

    function showChangesForCurrentIssue() {
        var issueNumber = getIssueNumber();
        if(typeof issueNumber == 'undefined')
            return;
        var changes = getChanges(issueNumber);
        if(changes.length == 0)
            return;
        var changesNode = $('<div></div>');
        addTitle(changesNode);
        addChanges(changes);
        changesNode.append($('<hr>'));
        changesNode.insertBefore($('#issue_tree'));

        function getIssueNumber() {
            var issueTypeAndNumber = $('#content>h2').text();
            var matches = RegExp('[\\d]+').exec(issueTypeAndNumber);
            if(matches && matches.length > 0)
                return matches[0];
            else
                return undefined;
        }

        function addTitle(parentNode) {
            var title = $('<p><strong></strong></p>');
            title.find('strong').text(getText('openChangesTitle'));
            parentNode.append(title);
        }

        function addChanges(changes) {
            changes = sortEldestFirst(changes);
            for(var i = 0; i < changes.length; i++) {
                var change = changes[i];
                var changeLink = getChangeLink(change);
                var paragraph = $('<p></p>');
                paragraph.append(changeLink);
                changesNode.append(paragraph);
                var lastRevisionNumber = change.revisions[change.current_revision]._number;
                var isDraft = change.revisions[change.current_revision].draft;
                if(isDraft)
                    markAsDraft(paragraph);
                var messages = getMessagesForRevision(change.messages, lastRevisionNumber);
                if(messages.length > 0) {
                    messages = getDecompositedMessages(messages, lastRevisionNumber);
                    if(hasAnyTrivial(messages)) {
                        var toggleMessages = getMessageToggler();
                        paragraph.append(toggleMessages);
                    }
                    var list = createMessagesList(change, messages, lastRevisionNumber);
                    changesNode.append(list);
                }
            }

            function sortEldestFirst(changes) {
                return changes.sort(function(a, b) {
                    return a._number - b._number;
                });
            }

            function markAsDraft(entryNode) {
                var link = entryNode.find('a');
                link.text(link.text() + ' [DRAFT]');
            }

            function hasAnyTrivial(messages) {
                var trivial = messages.filter(function(message) {
                    return message.trivial;
                });
                return trivial.length > 0;
            }

            function getMessageToggler() {
                var toggleMessages = $('<a></a>').text("▽").addClass('toggle-messages');
                toggleMessages.attr('title', getText('showTrivialMessagesTooltip'));
                toggleMessages.css({
                    'padding': '5px',
                    'cursor': 'pointer'
                });
                toggleMessages.click(function() {
                    var self = $(this);
                    self.parent().next('.messages').find('.trivial').toggle();
                    if(self.text() == "▽") {
                        self.attr('title', getText('hideTrivialMessagesTooltip'));
                        self.text("△");
                    } else {
                        self.attr('title', getText('showTrivialMessagesTooltip'));
                        self.text("▽");
                    }
                });
                return toggleMessages;
            }
        }

        function getChangeLink(change) {
            var node = createChangeLink(change);
            node.css('color', getChangeColor(change, false));
            return node.text(getChangeLinkText(change));

            function getChangeLinkText(change) {
                return getReviewText(change) + " " + drySubject(change.subject);
            }
        }

        function createChangeLink(change) {
            var node = $('<a></a>');
            var changeUrl = '{{gerritServer}}/{{changeNumber}}/';
            changeUrl = changeUrl.replace('{{gerritServer}}', GERRIT_SERVER);
            changeUrl = changeUrl.replace('{{changeNumber}}', change._number);
            node.attr('href', changeUrl);
            return node;
        }

        function getReviewText(change) {
            var codeReview = getCodeReviewState(change);
            var verified = getVerifiedState(change);
            if(codeReview == 2)
                codeReview = '✓';
            else if(codeReview == 1)
                codeReview = '+1';
            else if(codeReview == -2)
                codeReview = '✗';
            if(verified == 1)
                verified = '✓';
            else if(verified == -1)
                verified = '✗';
            else
                verified = '0';
            return codeReview + verified;
        }

        function drySubject(subject) {
            subject = subject.replace('[#' + issueNumber + '] ', '');
            return subject.replace('[close #' + issueNumber + ']', '[close]');
        }

        function getMessagesForRevision(messages, revisionNumber) {
            return messages.filter(function(message) {
                return message._revision_number == revisionNumber;
            });
        }

        function getDecompositedMessages(rawMessages, lastRevisionNumber) {
            var result = [];
            for(var i = 0; i < rawMessages.length; i++) {
                var message = rawMessages[i];
                var trivial = isTrivial(message);
                var messageContent = message.message;
                var preamble = messageContent.split('\n\n')[0];
                var coverMessage = '';
                if(messageContent.indexOf('\n\n') > -1)
                    coverMessage = messageContent.replace(preamble + '\n\n', '');
                preamble = preamble.replace('Patch Set ' + lastRevisionNumber + ': ', '');
                preamble = preamble.replace('Patch Set ' + lastRevisionNumber + ':', '');
                result.push({
                    'author': message.author,
                    'coverMessage': coverMessage,
                    'messages': message.messages,
                    'preamble': preamble,
                    'trivial': trivial
                });
            }
            return result;

            function isTrivial(message) {
                if(0 == message.message.indexOf("Uploaded patch set"))
                    return true;
                if(typeof JENKINS_USERNAME !== 'undefined' && JENKINS_USERNAME == message.author.name)
                    return message.message.indexOf('Build Started') > 0
                        || message.message.indexOf('Build Successful') > 0;
                return false;
            }
        }

        function createMessagesList(change, messages, lastRevisionNumber) {
            var list = $('<ul></ul>').addClass('messages');
            var trivials = 0;
            for(var i = 0; i < messages.length; i++) {
                var message = messages[i];
                var trivial = message.trivial;
                var entry = createMessageListEntry(message);
                if(trivial) {
                    entry = markAsTrivial(entry);
                    trivials++;
                }
                list.append(entry);
            }
            var commentLink = generateCommentLink(change, lastRevisionNumber);
            if(trivials == messages.length)
                commentLink = markAsTrivial(commentLink);
            list.append(commentLink);
            return list;

            function createMessageListEntry(message) {
                var preamble = message.preamble;
                var coverMessage = message.coverMessage;
                var entry = $('<li></li>');
                entry.text(message.author.name);
                if(preamble) {
                    entry.text(entry.text() + ' - ');
                    entry.append($('<b></b>').text(preamble));
                }
                if(coverMessage) {
                    coverMessage = coverMessage.replace(/\n/g, '<br>');
                    entry.append($('<blockquote></blockquote>').append(coverMessage).linkify());
                }
                return entry;
            }

            function generateCommentLink(change, lastRevisionNumber) {
                var commentLink = $('<a></a>');
                var commentUrl = '{{gerritUrl}}/#/c/{{changeId}}/{{revision}},publish';
                commentUrl = commentUrl.replace('{{gerritUrl}}', GERRIT_SERVER);
                commentUrl = commentUrl.replace('{{changeId}}', change._number);
                commentUrl = commentUrl.replace('{{revision}}', lastRevisionNumber);
                commentLink.attr('href', commentUrl);
                commentLink.text(getText('commentLink'));
                return $('<li></li>').append(commentLink).css('list-style', 'none');
            }

            function markAsTrivial(node) {
                return node.addClass('trivial').css('display', 'none');
            }
        }
    }

    function getChanges(issueNumber) {
        var data = getData();
        return data[issueNumber] || [];
    }

    function saveData(toSave) {
        toSave.updated = new Date();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    }

    function isIssueListPagePresent() {
        return $('body').hasClass('action-index');
    }

    function showChangesInformationOnIssueList() {
        var rowSelector = 'table.issues tr';
        function getIssueNumber(row) {
            return row.find('td.id a').text();
        }
        function getStatusNode(row) {
            return row.find('td.status');
        }
        _showChangesInformationOnIssueList(rowSelector, getIssueNumber, getStatusNode);
    }

    function _showChangesInformationOnIssueList(rowSelector, getIssueNumber, getStatusNode) {
        var data = getData();
        $(rowSelector).each(function() {
            var self = $(this);
            var issueNumber = getIssueNumber(self);
            var changes = data[issueNumber] || [];
            addChangesCounters(self);
            displayFixOrMergeStatuses(self);

            function addChangesCounters(row) {
                if(changes.length > 0) {
                    var statusNode = getStatusNode(row);
                    statusNode.text('(' + changes.length.toString() + ') ' + statusNode.text());
                }
            }

            function displayFixOrMergeStatuses(row) {
                var color;
                var toFix = false;
                var toMerge = false;
                for(var i = 0; i < changes.length; i++) {
                    var change = changes[i];
                    toFix = toFix || needsFix(change);
                    toMerge = toMerge || needsMerge(change);
                }
                if(toFix)
                    color = STATUS_COLORS['toFix'];
                else if(toMerge)
                    color = STATUS_COLORS['toMerge'];
                else if(changes.length > 0)
                    color = STATUS_COLORS['default'];
                getStatusNode(row).css('color', color);
            }
        });
    }

    function getData() {
        var raw = localStorage.getItem(STORAGE_KEY);
        if(raw)
            return JSON.parse(raw);
        else
            throw 'No data yet.';
    }

    function getText(source) {
        if($('html').attr('lang') == 'pl')
            return getTextForLanguage(source, 'PL');
        else
            return getTextForLanguage(source);
    }

    function getTextForLanguage(source, language) {
        if(language === undefined || !(language in TRANSLATIONS))
            language = DEFAULT_LANGUAGE;
        var possibleTranslations = [
            TRANSLATIONS[language][source],
            TRANSLATIONS[DEFAULT_LANGUAGE][source],
            ''
        ];
        return getFirstDefined(possibleTranslations);

        function getFirstDefined(array) {
            var defined = array.filter(function(element) {
                return typeof element !== 'undefined';
            });
            return defined[0];
        }
    }

    function getChangeColor(change, useDefault) {
        useDefault = typeof useDefault !== 'undefined' ? useDefault : true;
        if(needsFix(change))
            return STATUS_COLORS['toFix'];
        else if(needsMerge(change))
            return STATUS_COLORS['toMerge'];
        else if(useDefault)
            return STATUS_COLORS['default'];
        else
            return undefined;
    }

    function needsFix(change) {
        var codeReview = getCodeReviewState(change);
        var verified = getVerifiedState(change);
        return codeReview < 0 || verified < 0;
    }

    function needsMerge(change) {
        var codeReview = getCodeReviewState(change);
        var verified = getVerifiedState(change);
        return verified == 1 && codeReview == 2;
    }

    function getCodeReviewState(change) {
        if(change.labels['Code-Review'].rejected)
            return -2;
        else if(change.labels['Code-Review'].approved)
            return 2;
        else if(change.labels['Code-Review'].disliked)
            return -1;
        else if(change.labels['Code-Review'].recommended)
            return 1;
        else
            return 0;
    }

    function getVerifiedState(change) {
        if(change.labels['Verified'].rejected)
            return -1;
        else if(change.labels['Verified'].approved)
            return 1;
        else
            return 0;
    }
});
