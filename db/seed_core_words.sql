-- ============================================================================
--  Standard ~200-word English core vocabulary (additive; safe to re-run).
--
--  WHY: core_fringe_ratio was computing against 30 words and hand-set flags —
--  a confidently wrong number, which is worse than a missing one. Core words
--  are the ~200 flexible words (verbs, pronouns, prepositions, describers)
--  that make up ~80% of everyday output; classification must be a JOIN against
--  this list, not a judgement call per card. Clinical constraint C5.
--
--  Apply after seed_catalogues.sql:  sqlite3 aac.db < db/seed_core_words.sql
-- ============================================================================

INSERT OR IGNORE INTO core_word_list (word, lang, rank, word_class) VALUES
('i','en',1,'pronoun'),('no','en',2,'marker'),('yes','en',3,'marker'),('want','en',4,'verb'),
('it','en',5,'pronoun'),('that','en',6,'pronoun'),('my','en',7,'pronoun'),('you','en',8,'pronoun'),
('more','en',9,'adjective'),('go','en',10,'verb'),('me','en',11,'pronoun'),('mine','en',12,'pronoun'),
('not','en',13,'negation'),('in','en',14,'preposition'),('on','en',15,'preposition'),
('is','en',16,'verb'),('all done','en',17,'phrase'),('some','en',18,'determiner'),
('help','en',19,'verb'),('do','en',20,'verb'),('up','en',21,'preposition'),('down','en',22,'preposition'),
('this','en',23,'pronoun'),('what','en',24,'question'),('stop','en',25,'verb'),('get','en',26,'verb'),
('here','en',27,'adverb'),('out','en',28,'preposition'),('off','en',29,'preposition'),
('a','en',30,'determiner'),('the','en',31,'determiner'),('to','en',32,'preposition'),
('open','en',33,'verb'),('put','en',34,'verb'),('look','en',35,'verb'),('like','en',36,'verb'),
('come','en',37,'verb'),('he','en',38,'pronoun'),('she','en',39,'pronoun'),('we','en',40,'pronoun'),
('they','en',41,'pronoun'),('make','en',42,'verb'),('big','en',43,'adjective'),('little','en',44,'adjective'),
('eat','en',45,'verb'),('drink','en',46,'verb'),('play','en',47,'verb'),('read','en',48,'verb'),
('where','en',49,'question'),('who','en',50,'question'),('why','en',51,'question'),('when','en',52,'question'),
('how','en',53,'question'),('can','en',54,'verb'),('will','en',55,'verb'),('turn','en',56,'verb'),
('give','en',57,'verb'),('take','en',58,'verb'),('good','en',59,'adjective'),('bad','en',60,'adjective'),
('again','en',61,'adverb'),('different','en',62,'adjective'),('same','en',63,'adjective'),
('finished','en',64,'adjective'),('now','en',65,'adverb'),('later','en',66,'adverb'),
('fast','en',67,'adjective'),('slow','en',68,'adjective'),('hot','en',69,'adjective'),('cold','en',70,'adjective'),
('happy','en',71,'adjective'),('sad','en',72,'adjective'),('angry','en',73,'adjective'),
('tired','en',74,'adjective'),('scared','en',75,'adjective'),('need','en',76,'verb'),
('feel','en',77,'verb'),('see','en',78,'verb'),('hear','en',79,'verb'),('say','en',80,'verb'),
('tell','en',81,'verb'),('know','en',82,'verb'),('think','en',83,'verb'),('work','en',84,'verb'),
('wait','en',85,'verb'),('walk','en',86,'verb'),('run','en',87,'verb'),('sit','en',88,'verb'),
('stand','en',89,'verb'),('sleep','en',90,'verb'),('wash','en',91,'verb'),('find','en',92,'verb'),
('lose','en',93,'verb'),('keep','en',94,'verb'),('let','en',95,'verb'),('ask','en',96,'verb'),
('answer','en',97,'verb'),('show','en',98,'verb'),('watch','en',99,'verb'),('listen','en',100,'verb'),
('with','en',101,'preposition'),('without','en',102,'preposition'),('under','en',103,'preposition'),
('over','en',104,'preposition'),('behind','en',105,'preposition'),('beside','en',106,'preposition'),
('between','en',107,'preposition'),('near','en',108,'preposition'),('far','en',109,'adjective'),
('away','en',110,'adverb'),('back','en',111,'adverb'),('there','en',112,'adverb'),
('and','en',113,'conjunction'),('or','en',114,'conjunction'),('but','en',115,'conjunction'),
('because','en',116,'conjunction'),('if','en',117,'conjunction'),('so','en',118,'conjunction'),
('very','en',119,'adverb'),('too','en',120,'adverb'),('also','en',121,'adverb'),
('only','en',122,'adverb'),('just','en',123,'adverb'),('really','en',124,'adverb'),
('please','en',125,'social'),('thank you','en',126,'social'),('sorry','en',127,'social'),
('hello','en',128,'social'),('goodbye','en',129,'social'),('all','en',130,'determiner'),
('none','en',131,'determiner'),('many','en',132,'determiner'),('much','en',133,'determiner'),
('another','en',134,'determiner'),('other','en',135,'determiner'),('every','en',136,'determiner'),
('new','en',137,'adjective'),('old','en',138,'adjective'),('first','en',139,'adjective'),
('last','en',140,'adjective'),('next','en',141,'adjective'),('before','en',142,'preposition'),
('after','en',143,'preposition'),('today','en',144,'adverb'),('tomorrow','en',145,'adverb'),
('yesterday','en',146,'adverb'),('always','en',147,'adverb'),('never','en',148,'adverb'),
('sometimes','en',149,'adverb'),('maybe','en',150,'adverb'),('done','en',151,'adjective'),
('ready','en',152,'adjective'),('wrong','en',153,'adjective'),('right','en',154,'adjective'),
('nice','en',155,'adjective'),('funny','en',156,'adjective'),('silly','en',157,'adjective'),
('loud','en',158,'adjective'),('quiet','en',159,'adjective'),('clean','en',160,'adjective'),
('dirty','en',161,'adjective'),('wet','en',162,'adjective'),('dry','en',163,'adjective'),
('full','en',164,'adjective'),('empty','en',165,'adjective'),('hard','en',166,'adjective'),
('soft','en',167,'adjective'),('long','en',168,'adjective'),('short','en',169,'adjective'),
('high','en',170,'adjective'),('low','en',171,'adjective'),('these','en',172,'pronoun'),
('those','en',173,'pronoun'),('him','en',174,'pronoun'),('her','en',175,'pronoun'),
('them','en',176,'pronoun'),('us','en',177,'pronoun'),('your','en',178,'pronoun'),
('his','en',179,'pronoun'),('their','en',180,'pronoun'),('our','en',181,'pronoun'),
('stop it','en',182,'phrase'),('turn on','en',183,'phrase'),('turn off','en',184,'phrase'),
('let''s','en',185,'phrase'),('don''t','en',186,'negation'),('can''t','en',187,'negation'),
('gentle','en',188,'adjective'),('share','en',189,'verb'),('break','en',190,'noun'),
('excited','en',191,'adjective'),('hungry','en',192,'adjective'),('thirsty','en',193,'adjective'),
('hurt','en',194,'verb'),('love','en',195,'verb'),('hate','en',196,'verb'),
('start','en',197,'verb'),('end','en',198,'verb'),('try','en',199,'verb'),('use','en',200,'verb');

-- Classification is a join, never a judgement call per card.
UPDATE cards SET is_core = CASE
  WHEN EXISTS (SELECT 1 FROM core_word_list w WHERE w.word = lower(cards.label)) THEN 1
  ELSE 0 END;
