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








Golomb-coded set (GCS) とは、ほぼ [ここ](http://giovanni.bajo.it/post/47119962313/golomb-coded-sets-smaller-than-bloom-filters) に書かれた通りなのでそれを元に紹介する。

# Golomb-coded sets: smaller than Bloom filters

A bloom filter with the optimal number of hash functions (= bits per element) usually occupies a space in memory that is N * log2(e) * log2(1/P) bits, where N is the number of elements that you want to store, and P is the false-positive probability. To put things into perspective, let's say you want to store 100K elements with 1 false positive every 8K elements. Given that log2(8K) ≈ log2(8192) = 13, and log2(e) ≈ 1.44, you need 100K * 1.44 * 13 bits ≈ 1828 KiB ≈ 1.78 MiB.

bloom filter 
適切な数の hash 関数(= bit/elem) を用意した場合、
保存したい要素数を N
誤検出の確率を P とすると
`N * log2(e) * log2(1/P)` bit 分メモリを消費します。


100K の要素を保存し、 8K ごとに 1 個の誤検出とした場合、1.78 KB 必要

```
log2(8K) := log2(8192) = 13
log2(e) := 1.44
100K * 1.44 * 13 bits := 1828 KiB := 1.78
```

The theoretical minimum for a similar probabilistic data structure would be N * log2(1/P), so a bloom filter is roughly using 44% more memory than theoretically necessary (log(e) = 1.44). GCS is a way to get closer to that minimum.

論理的な下限値は `N * log2(1/P)` なので `log(e) = 1.44` の分として 44% だけ冗長である。
GCS はこの下限値に近づける方法である。


GCS is well suit in situations where to want to minimize the memory occupation and you can afford a slightly higher computation time, compared to a Bloom filter. Google Chromium, for instance, uses it to keep a local (client) set of SSL CRL; they prefer lower memory occupation because it is specifically important in constrained scenarios (e.g.: mobile), and they can afford the structure to be a little bit slower than Bloom filter since it's still much faster than a SSL handshake (double network roundtrip).





## Turning words into values

GCS is actually quite simple, and I will walk you through it step by step. First, let's agree on a dictionary of words you want to put into the set, for instance, the NATO alphabet:

GCS は実際は非常にシンプル。
ここでは例として NATO アルファベットを扱う。


```
['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike',
 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra',
 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee',
 'zulu']
```

We want to create a data-structure for these words with a 1 on 64 false-positive probability. This means that we expect that we will be able to check the whole english dictionary against it, and about 1 word every 64 will result to be present even if it's not.

これを 1/64 の疑陽性の構造体を作ります。
これは

We compute a single hash key for each different element, as integers in the range [0, NxP). Since N=26 (the length of the NATO alphabet) and P=64, the range is [0, 1664]. As in the case of Bloom filters, we want this hash to be uniformly distributed across the domain, so a cryptographic hash like MD5 or SHA1 is a good choice (and no, the fact that there are pre-image attacks on MD5 does not matter much in this scenario). We will need a way to convert a 128-bit or 160-bit hash to a number in the range [0, 1664], but the moral equivalent of the modulus is the enough to not affect the distribution. We will then compute the hash as follows:

```
def gcs_hash(w, (N,P)):
    """
    Hash value for a GCS with N elements and 1/P probability
    of false positives.
    We just need a hash that generates uniformally-distributed
    values for best results, so any crypto hash is fine. We
    default to MD5.
    """
    h = md5(w).hexdigest()
    h = long(h[24:32],16)
    return h % (N*P)
```

If we apply this function over the input words, we get these hash values:

```
[('alpha', 1017L), ('bravo', 591L), ('charlie', 1207L), ('delta', 151L),
 ('echo', 1393L), ('foxtrot', 1005L), ('golf', 526L), ('hotel', 208L),
 ('india', 461L), ('juliet', 1378L), ('kilo', 1231L), ('lima', 192L),
 ('mike', 1630L), ('november', 1327L), ('oscar', 997L), ('papa', 662L),
 ('quebec', 806L), ('romeo', 1627L), ('sierra', 866L), ('tango', 890L),
 ('uniform', 1134L), ('victor', 269L), ('whiskey', 512L), ('xray', 831L),
 ('yankee', 1418L), ('zulu', 1525L)]
```

Let's now just get the hash values and sort them. This is the result:

```
[151L, 192L, 208L, 269L, 461L,
 512L, 526L, 591L, 662L, 806L,
 831L, 866L, 890L, 997L, 1005L,
 1017L, 1134L, 1207L, 1231L,
 1327L, 1378L, 1393L, 1418L,
 1525L, 1627L, 1630L]
```

Remember that the range was [0, 1664). Given that we used a cryptographic hash, we expect these values to be uniformly distributed across that range. They look like it at glance, and obviously it gets much better with real-world data sets which are much larger. If we plot these values, we can double-check the distribution:


Let's compress

We now want to compress this set of number in the most efficient way. General purpose algorithms like zlib are obviously the wrong choice here, since they work by finding repetition of strings, and the 16-bit or 32-bit encoding of the above numbers would look like random data to zlib. Some compression theory comes to the rescue: the best way to compress an unordered uniform data set is to compute the array of differences, which will be a geometric distribution, and then use the Golomb encoding. Did I lose you? Let's see it one step at a time.

If we compute the increments (differences) between a uniformly distribute set of values, the result is a geometric distribution. Recall that we originally decided for a range of exactly 26x64, and then we picked 26 uniformly distributed values within it. If you were to bet on the most likely distance between a value and the next one, wouldn't you say "64"? Yes. And we can argue that most distances are going to be numbers pretty close to the value 64, and far larger values are extremely unlikely. This intuition matches with the geometric distribution (whose correspondent in the continuos domain is the exponential distribution).

In our example, this is the array of differences:


[151L, 41L, 16L, 61L, 192L, 51L, 14L, 65L, 71L, 144L,
 25L, 35L, 24L, 107L, 8L, 12L, 117L, 73L, 24L, 96L,
 51L, 15L, 25L, 107L, 102L, 3L]
Again, we can check this with a little plot (after sorting them):


The parameter p of this geometric distribution should be exactly the false probability we chose above (1/64). To double-check, we can estimate the parameter p by dividing the number of values by their sum: 26 / 1438 = 0.0175320, which is close enough to 1 / 64 = 0.015625. Again, with a larger input set, the numbers would be even closer.

Golomb encoding

We now want to compress this set of differences with Golomb encoding. As Wikipedia says, "alphabets following a geometric distribution will have a Golomb code as an optimal prefix code, making Golomb coding highly suitable for situations in which the occurrence of small values in the input stream is significantly more likely than large values". In fact, we are going to use simplified sub-case of Golomb encoding, in which the parameter p is a power of 2 (like 64 is, in our case). This sub-case is called Rice encoding.

Back to the intuition: we are going to compress values which are very likely to be as small as the value 64, and very unlikely to be much bigger; 128 is unlikely, 192 is very unlikely, 256 is very very unlikely, and so on. Golomb encoding splits each value in two parts: the quotient and the remainder of the division by the parameter. Given what we just said about the likeness, you must expect the quotient to be likely 0 or 1, unlikely to be 2, very unlikely to be 3, very very unlikely to be 4, etc. On the other hand, the remainder is probably just a random number we can't infer much about, it’s the high frequency oscillation which is impossible to predict. Golomb (Rice) coding simply encodes the quotient in base 1 (unary encoding) and the remainder in base 2 (binary encoding). Unary encoding might sound weird at first, but it’s really simple:




```
Number          Unary encoding
   0            0
   1            10
   2            110
   3            1110
   4            11110
   5            111110
   6            1111110
```


So we emit as many 1s as the number we want to encode (the quotient) followed by a zero. Then, we emit the binary encoding of the remainder using exactly 6 bits (since it will be a number between 0 and 63). Thus, a number between 0 and 63 will be exactly 7 bits long: 1 bit for the quotient (0) and 6 bits for the remainder. A number between 64 and 127 will be 8 bits long (quotient 10, plus the remainder); A number between 128 and 191 will be 9 bits long (quotient 110); and so on. Smaller numbers are as compact as possible, higher and unlikely numbers gets longer and longer. Let's see our array of differences properly encoded:



```
Number  Quot    Rem     Golomb encoding
151     2       23      110  010111
41      0       41      0    101001
16      0       16      0    010000
61      0       61      0    111101
192     3       0       1110 000000
51      0       51      0    110011
14      0       14      0    001110
65      1       1       10   000001
71      1       7       10   000111
144     2       16      110  010000
25      0       25      0    011001
35      0       35      0    100011
24      0       24      0    011000
107     1       43      10   101011
8       0       8       0    001000
12      0       12      0    001100
117     1       53      10   110101
73      1       9       10   001001
24      0       24      0    011000
96      1       32      10   100000
51      0       51      0    110011
15      0       15      0    001111
25      0       25      0    011001
107     1       43      10   101011
102     1       38      10   100110
3       0       3       0    000011
```

And if we concatenate all the output, we get our final Golomb-coded set of numbers:

```
11001011 10101001 00100000 11110111
10000000 01100110 00111010 00000110
00011111 00100000 01100101 00011001
10001010 10110001 00000011 00101101
01100010 01001100 01010000 00110011
00011110 01100110 10101110 10011000
00011
```

197 bits (25 padded bytes) to encode 26 arbitrary-long words with a 1.5% of false positives. That's 7.57 bits per word. Not bad! The theoretical minimum number of bits was 26 * log2(64) = 156, so we’re still a little off in this example, but still better than an optimal Bloom filter which would require 225 bits. The example I chose is obviously too small and thus it’s very impacted by the specific words and the output of the MD5. I ran the same algorithm over a 640K-words English dictionary with expected false probability 1/1024, and I got a 7,405,432 bits GCS, which is about 11.58 bits per word. An optimal Bloom filter for the same set would take 9,227,646 bits, while the theoretical minimum would be 6,396,530 bits. Quite an improvement, in fact.

Decompression and query improvements

So how do we now query for a word to see if it's in the set or not? We just need to reverse all the steps.

We start going through the bits. We extract the quotient Q by simply counting the number of consecutive 1s before the terminating 0; then we extract the fixed-size remainder R (exactly P bits, 6 in our example). We compute the original difference (QxP+R), and we accumulate it into an integer so that we regenerate the original sorted set of hash values, one element at a time. We don't need to actually expand the whole set in memory: as we go through the bits and compute one hash value at a time, we can compare it with the one that we are being queried for, to see if there’s a match.

After you reverse the encoding and difference steps, the underlying hash value set is sorted. So going through the set in linear order sounds like slower than it could be. One would think of doing a bisect search, but there is no easy way to jump to an arbitrary index in the encoded set, since the encoded elements have different size in bits, and they can be decoded only one at a time in linear order.

What we can do to improve query time a bit is to compute an index that allows to seek within the encoded set. For instance, if you want to make the query time 32 times faster, you can split the original domain [0...NxP) in 32 subdomains of equal size NxP/32. Then, for each subdomain, you find the smallest hash value that is part of the subdomain, and save its bit-index in the encoded GCS within the index. Since the hash values are uniformly distributed, each subdomain will contain roughly N/32 values, so by seeking into it while querying you will need to decode only 1/32th of the whole GCS, thus getting the 32x speed increase in query time. In the full English dictionary example cited above, an additional index made of 32 indices of 32-bits each is just 1,204 bits of additional memory; compared to a 7 million bits GCS, it's a good deal to obtain a 32x speed increase in query time!

Play with the code

The full code is available on GitHub. I wrote both a Python and a C++ implementation that you can compare. The Python code is meant to be really simple and not really optimized (e.g.: it even streams the set from the disk when you do a query). The C++ is a little bit more optimized, though still mostly an academic example. Notice that the code does not implement the index to speed up decompression. Even if it's good deal, it’s obviously not mandatory and just an optimization.




















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

