(function () {
    "use strict";

    angular.module('blocktrail.core')
        .factory('bitcoinLinkService', bitcoinLinkService);

    function bitcoinLinkService($state, bip70, bitcoinJS, $q) {
        // borrowed from bip21, with a modification for optional addresses
        // in urls.
        function decodeBitcoinLink(uri) {
            var qregex = /(bitcoin|bitcoincash):\/?\/?([^?]+)?(\?([^]+))?/.exec(uri);
            if (!qregex) throw new Error('Invalid BIP21 URI: ' + uri);

            var protocol = qregex[1];
            var address = qregex[2];
            var query = qregex[4];

            var options = parseQuery("?"+query);
            if (options.amount) {
                options.amount = Number(options.amount);
                if (!isFinite(options.amount)) throw new Error('Invalid amount');
                if (options.amount < 0) throw new Error('Invalid amount');
            }

            return { address: address, options: options, protocol: protocol};
        }

        function parse(bitcoinLink) {
            var deferred = $q.defer();

            try {
                var uri = decodeBitcoinLink(bitcoinLink);
            } catch (e) {
                deferred.reject('Unable to decode bitcoin link. May be corrupted');
                return deferred.promise;
            }

            var res = {};
            res.network = uri.protocol;

            // BIP70
            if (uri && uri.options && uri.options.r) {
                var paymentUrl = uri.options.r;
                // . ..
                var validation = new bip70.X509.RequestValidator({
                    trustStore: bip70.X509.TrustStore
                });

                var client = new bip70.HttpClient();

                var network;
                var networkConfig;
                if (uri.protocol == 'bitcoin') {
                    networkConfig = bip70.NetworkConfig.Bitcoin();
                    network = bitcoinJS.networks.bitcoin;
                    // TODO: BCH BIP70 is currently incompatible with BitPay
                } else {
                    deferred.reject('Unsupported network for BIP70 requests');
                }

                client.getRequest(paymentUrl, validation, networkConfig)
                    .then(function(request) {
                        var details = bip70.ProtoBuf.PaymentDetails.decode(request[0].serializedPaymentDetails);
                        if (details.outputs.length > 1) {
                            deferred.reject("Multiple output payment requests are not supported");
                        }
                        res.recipientAddress = bitcoinJS.address.fromOutputScript(blocktrailSDK.Buffer.from(details.outputs[0].script), network);
                        res.recipientSource = 'BIP70PaymentURL';
                        res.referenceMessage = details.memo;
                        res.inputDisabled = true;
                        res.amount = parseFloat(blocktrailSDK.toBTC(details.outputs[0].amount));
                        deferred.resolve(res);
                    }, function(err) {
                        console.log("err - abort request");
                        console.log(err.message);
                        $state.go('app.wallet.summary');
                    });
            } else {
                res.recipientAddress = uri.address;
                res.referenceMessage = uri.message;
                res.recipientSource = 'ScanQR';
                res.amount = uri.options.amount;

                if (uri.address && uri.options.amount) {
                    res.inputDisabled = true;
                }

                deferred.resolve(res);
            }

            return deferred.promise;
        }

        return {
            parse: parse,
            decodeBitcoinLink: decodeBitcoinLink
        };
    }
})();
