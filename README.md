# casper.js を作った、または Cache Aware Server Push を用いた HTTP/2 Push の効率化

分かってる人にとっては、「casper.js を作った」だけで伝わるかもしれませんが、そうでない場合非常に話すべきことがたくさん有る気がするので、順を追って説明します。

今回理解すべき内容は以下


- http2 push の問題点
- cache aware server push
- bloom filter と golomb coded set
- cache fingerprinting
- casper.js


# http2 push の問題点

http2 で push することで、リソースをブラウザにキャッシュしてキャッシュヒットさせる、というユースケースについてはもう散々語られたと思うので、それは前提とします。

問題は、例えば index.html へのリクエストで script.js を push する設定をした場合に、サーバは毎回 script.js を push しては無駄なわけです。
もしすでに push 済みであれば、 push しないで index.html に対するレスポンスを返し、 script.js を速やかにリクエストさせてキャッシュヒットさせたい。

問題はつまりこういうことです。

> ブラウザが何をキャッシュとして持っているか、サーバが知る方法が無い


ブラウザのキャッシュを取得できると、閲覧履歴などがわかってしまい問題となる可能性もあるため、基本的にこういうことはできません。


# cache aware server push

そこで、例えばサーバが script.js を Push をしたあとに、その事実を index.html の Cookie に付与しておけば、次のリクエストでは 「index.html が欲しいけど scirpt.js はもうキャッシュに有るから push しないでいいよ」という情報がとれます。

これによって、無駄な Push を減らそうというのが、 kazuho さんの考えた Cache Aware Server Push という方式です。

では、実際 cookie には何の情報を入れればいいでしょうか？


例えば、 script.js を Push したら "script.js" って書けばいいかもしれません。
しかし、それだとキャッシュされた script.js よりも、サーバが持っている script.js が新しく更新された場合に、「新しくなったから更新」ということができません。

そこで、ファイルのバージョンを示すのに使われる Etag の値を一緒に載せると良さそうです。

こんな感じでしょうか。

```
/assets/scripts/script.js:zidr965q3jalsfda4
```

でもこれ、ファイルパスや Etag が長くて、さらにファイルが何個もあったら、すぐに膨らんでしまいます。
Cookie は他にも多くの情報を入れるために使われるので、ちょっと辛いですね。

そこで、この情報をうまく圧縮することを考えます。


# false positive

ファイルパスと Etag があれば十分ではありますが、本質的に欲しい情報は何かと言うと

「今から Push しようとしているファイルは、すでにキャッシュに有るかどうか？」です。

ところで 100% わからないとダメでしょうか？
そもそも、ブラウザのキャッシュなんていつ消えるかわかりません。 Cookie がそれと完全に同期するのがそもそも無理です。

そして、もし当てが外れても以下の二通りです。

- 「キャッシュされてると思って Push しなかったら、されてなかった」=> ブラウザが普通に GET するだけ
- 「キャッシュされてないと思って Push したら、されてた」 => キャッシュが上書きされるだけ

実は Push は読みが外れても動かなくなるものではありません。しかしどっちにせよ無駄な処理は減らしたいです。
つまり狙い目は、「なるべく無駄な Push を減らす」ことであり、そうすると本当に欲しい情報はこうです。


「今から Push しようとしているファイルは、すでにキャッシュに *有りそうかどうか?*」


100% でなくてもよい(あると思ったら無かった=false positive が許される)、となると実は情報を圧縮する方法がいくつかあります。
その代表例が確率的データ構造である bloom fileter です。


# bloom filter

bloom filter については [こちら](http://dev.ariel-networks.com/column/tech/boom_filter/) 説明あたりがわかりやすいと思います。

例えば、







Golomb-coded set (GCS) とは、ほぼ [ここ](http://giovanni.bajo.it/post/47119962313/golomb-coded-sets-smaller-than-bloom-filters) に書かれた通りなのでそれを元に紹介する。


GCS は bloom filter に似た構造体だが、より省メモリかつ高速に動作する。














# cache fingerprinting

cache fingerprinting とは、 server が投機的な push をすべきかどうかを知るために仕様することができます。

http2 の push はサーバが投機的に行うが、クライアントがすでにそのリソースをキャッシュしているかを知る方法はない。
この仕様は、 HTTP ヘッダにその情報を含むことでより効率的に push することを目的とする。


# Cache-Fingerprint-Key ヘッダ

"Cache-Fingerprint-Key" は fingerprint key を表す decimal number を値とする。

```
Cache-Fingerprint-Key: 12345
```

# Cache-Fingerprint Header Field

user agent はキャッシュしたレスポンスの fingerprint key を集め、Cache-Fingerprint ヘッダで送る。

user agent は fingerprint がキャッシュされて無くてもこのヘッダをかならず送る。

user agent が "Cache-Fingerprint" ヘッダを送った場合、 value は以下の用に処理される。

1. キャッシュされたレスポンスから "Cache-Fingerprint-Key" を集め、
2. なかったら 9 へ
3. key を代数ソートする
4. Golomb-Rice coding でパラメータを導出する。値は 2 の累乗で 1~2147483648 の範囲。
5. 4 の結果の log2 を 5-bit 値で導出
6. 4 の結果のキーを Golomb-Rice coding でエンコード
7. 結果が 1 つなら 9 へ
8. 最初のキー以外のキーを、一つ前のキーから

